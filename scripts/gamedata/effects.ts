// Turns the wiki's effect wording into simulator rules.
//
// Input is cleaned text where status names are marked as ⟦Name⟧ and trigger
// labels as [On Hit]. Each sentence is parsed completely or not at all: when
// any part is not understood, the sentence is kept as a note (shown with the
// item, not simulated), so the simulator never runs half of an effect.
import type { Action, Condition, Effect, ModStat, Quantity, Trigger, Value, Who } from "../../src/data/schema";
import type { DmgType, Sin } from "../../src/engine/constants";

export type Where = "skill" | "coin" | "passive" | "gift" | "status";

export interface StatusInfo {
  key: string;
  mode: "pc" | "value";
}
export type StatusLookup = (name: string) => StatusInfo;

export interface Converted {
  effects: Effect[];
  notes: string[];
  flags: { indiscriminate?: boolean; unclashable?: boolean; unbreakable?: boolean; counter?: boolean; clashable?: boolean; excision?: boolean };
  sentences: number;
  parsed: number;
  /** Sentences that only describe targeting/AI (kept as notes, not counted). */
  info: number;
}

// ---------------------------------------------------------------------------------
// small builders (plain objects; the importer validates everything with zod later)
// ---------------------------------------------------------------------------------
const V = (base: number): Value => ({ base, per: null, min: null, max: null });
const Q = (kind: Quantity["kind"], extra: Partial<Quantity> = {}): Quantity => ({ kind, who: "self", status: "BURN", field: "potency", sin: "WRATH", ...extra });
const A = (kind: Action["kind"], extra: Partial<Action> = {}): Action => ({
  kind, who: "target", count: 1, status: "BURN", potency: V(0), amount: V(1), timing: "now", field: "count", hpMode: "flat",
  stat: "dmgDealt", scope: "skill", sin: null, dmgType: null, coin: 0, tremorType: "DECAY", entangle: false, text: "", ...extra,
});
const C = (kind: Condition["kind"], extra: Partial<Condition> = {}): Condition => ({
  kind, not: false, who: "target", q: null, q2: null, op: ">=", value: 1, status: "BURN", sin: "WRATH", dmgType: "SLASH", slot: "S1", text: "", ...extra,
});

const SIN_WORDS: Record<string, Sin> = { wrath: "WRATH", lust: "LUST", sloth: "SLOTH", gluttony: "GLUTTONY", gloom: "GLOOM", pride: "PRIDE", envy: "ENVY" };
const DMG_WORDS: Record<string, DmgType> = { slash: "SLASH", pierce: "PIERCE", penetrate: "PIERCE", blunt: "BLUNT" };

// Trigger labels in [brackets] → engine triggers.
const BRACKET_TRIGGERS: Record<string, Trigger> = {
  "on hit": "onHit",
  "on use": "onUse",
  "before use": "onUse",
  "effect on use": "onUse",
  "heads hit": "headsHit",
  "tails hit": "tailsHit",
  "on hit without cracking": "hitWithoutCracking",
  "attack end": "attackEnd",
  "skill end": "attackEnd",
  "clash lose": "clashLose",
  "clash win": "clashWin",
  "combat start": "combatStart",
  "start battle": "combatStart",
  "before attack": "beforeAttack",
  "on crit": "onCrit",
  "turn end": "turnEnd",
  "turn start": "turnStart",
  "on evade": "onEvade",
  "on kill": "onKill",
  "on target kill": "onKill",
  "hit after clash win": "hitAfterClashWin",
  "hit after clash lose": "hitAfterClashLose",
  "current coin attack end": "coinAttackEnd",
  "coin start": "coinStart",
  "clash start": "clashStart",
  "on unopposed attack": "unopposedAttack",
  constant: "always",
  "always active": "always",
};
/** Labels that also need a condition: [Reuse - On Hit] only counts for a reused Coin, etc. */
const BRACKET_EXTRA: Record<string, { trigger: Trigger; conds: () => Condition[] }> = {
  "reuse - on hit": { trigger: "onHit", conds: () => [C("isReuse")] },
  "reuse on hit": { trigger: "onHit", conds: () => [C("isReuse")] },
  "crit - heads hit": { trigger: "onCrit", conds: () => [C("isHeads")] },
  "on crit - heads hit": { trigger: "onCrit", conds: () => [C("isHeads")] },
};
const FLAG_BRACKETS = new Set(["indiscriminate", "unclashable", "clashable counter", "clashable guard", "target fixed", "aoe"]);

/** Sentences that only describe targeting / AI / UI; kept as notes but not counted as "missing". */
const INFO_PATTERNS: RegExp[] = [
  /^targets? (?:randomly|the unit|the rearmost|the frontmost|.*lowest|.*highest|.*most|.*least)/i,
  /^prioriti[sz]es? /i,
  /^can clash with this skill regardless of speed/i,
  /panic type/i,
  /^turn end: if in panic, reset sp/i,
  /inflicted against non-sp units/i,
  /^unfocused volley$/i,
  /^\[?effects apply only to/i,
  /^this (?:skill|unit) (?:is|has) /i,
  /^(?:cannot|can't) be (?:used|selected|targeted)/i,
  /^dies when /i,
  /exclusive skill$/i,
  /^the following effects activate depending on/i,
  /^(?:in )?focused encounters?/i,
  /^sp (?:is )?fixed/i,
];
export function isInfo(sentence: string): boolean {
  const t = display(sentence).replace(/^\[[^\]]+\]\s*/, "").replace(/^[-•]\s*/, "");
  return INFO_PATTERNS.some((re) => re.test(t));
}

/** Normalise wording before parsing. */
function prep(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/⟦(Tremor Burst|Unbreakable Coins?|Excision Coins?|Clashable Guard|Clashable Counter|Sinking Deluge|Amplitude Conversion|Amplitude Entanglement|Critical Hit|Stagger(?:ed)?|Resonance|Absolute Resonance)⟧/gi, "$1")
    .replace(/\s*\((?:or all (?:Abnormality )?parts|including (?:this unit|self|the user)|excluding (?:this unit|self))\)/gi, "")
    .replace(/\s+or 'Unique (?:Burn|Bleed|Tremor|Rupture|Sinking|Poise|Charge)'/gi, "")
    .replace(/\s+or (?:a )?Unique (?:Burn|Bleed|Tremor|Rupture|Sinking|Poise|Charge)\b/gi, "")
    .replace(/[ \t]+/g, " ");
}

// ---------------------------------------------------------------------------------
// Tokenised sentence reader
// ---------------------------------------------------------------------------------
class Reader {
  constructor(public s: string, public statuses: StatusLookup) {}
  /** Try a regex at the start; on success consume it and return the match. */
  eat(re: RegExp): RegExpExecArray | null {
    const m = new RegExp("^(?:" + re.source + ")", re.flags.includes("i") ? "i" : "").exec(this.s);
    if (!m) return null;
    this.s = this.s.slice(m[0].length).replace(/^\s+/, "");
    return m;
  }
  peek(re: RegExp): boolean {
    return new RegExp("^(?:" + re.source + ")", "i").test(this.s);
  }
  get done() {
    return this.s.replace(/^[\s.,;:!]+/, "") === "";
  }
  status(): string | null {
    const m = /^⟦([^⟧]+)⟧/.exec(this.s);
    if (!m) return null;
    this.s = this.s.slice(m[0].length).replace(/^\s+/, "");
    return m[1];
  }
}

const NUM = String.raw`[+-]?\d+(?:\.\d+)?`;
const num = (x: string) => Number(x.replace("+", ""));

interface Partial2 {
  conditions: Condition[];
  actions: Action[];
  perTurn?: number;
  perEncounter?: number;
  perUse?: number;
  trigger?: Trigger;
}

function who(word: string | undefined, dflt: Who): Who {
  if (!word) return dflt;
  const w = word.toLowerCase().trim();
  if (/^(self|this unit|user|the user|themselves|itself|oneself|this character)$/.test(w)) return "self";
  if (/^(the )?target$/.test(w) || w === "the target" || w === "main target") return "target";
  if (/^all allies$|^allies$|^every ally$/.test(w)) return "allAllies";
  if (/^(all )?other allies$/.test(w)) return "otherAllies";
  if (/^all enemies$|^every enemy$|^enemies$/.test(w)) return "allEnemies";
  if (/^(a |1 )?random enemy$/.test(w)) return "randomEnemy";
  if (/^(a |1 )?random ally$/.test(w)) return "randomAlly";
  if (/ally with the lowest hp/.test(w)) return "lowestHpAlly";
  if (/ally with the lowest sp/.test(w)) return "lowestSpAlly";
  if (/fastest ally/.test(w)) return "fastestAlly";
  if (/slowest ally/.test(w)) return "slowestAlly";
  return dflt;
}

/** "⟦X⟧ [Count|Potency] [on self|on target]" → a status quantity */
function readStatusQ(r: Reader, lookup: StatusLookup, dflt: Who): Quantity | null {
  const save = r.s;
  const st = r.status();
  if (!st) return null;
  const info = lookup(st);
  const isCount = !!r.eat(/Count\b/i);
  r.eat(/Potency\b/i);
  let w = dflt;
  const on = r.eat(/(?:on|of) (self|this unit|the target|target|the main target)\b/i);
  if (on) w = who(on[1].replace("main ", ""), dflt);
  if (!info) {
    r.s = save;
    return null;
  }
  return Q(isCount ? "statusCount" : "statusPotency", { who: w, status: info.key, field: isCount ? "count" : "potency" });
}

/** "(X + Y) [on target]" → two summed status quantities */
function readSumQ(r: Reader, lookup: StatusLookup, dflt: Who): [Quantity, Quantity] | null {
  const save = r.s;
  if (!r.eat(/\(\s*/)) return null;
  const a = readStatusQ(r, lookup, dflt);
  if (!a || !r.eat(/\+\s*/)) {
    r.s = save;
    return null;
  }
  const b = readStatusQ(r, lookup, dflt);
  if (!b || !r.eat(/\)\s*/)) {
    r.s = save;
    return null;
  }
  const on = r.eat(/(?:on|of) (self|this unit|the target|target|the main target)\b/i);
  if (on) {
    const w = who(on[1].replace("main ", ""), dflt);
    // only statuses that did not name their own owner take the shared one
    if (!/ on | of /i.test(save.slice(0, save.indexOf(")")))) {
      a.who = w;
      b.who = w;
    }
  }
  return [a, b];
}

/** "for every N X on target (max M)" / "for every N X on self" / "for every X" → Value multiplier */
function readPer(r: Reader, amountPer: number, lookup: StatusLookup): { per: Value["per"]; max: number | null } | null {
  const save = r.s;
  if (!r.eat(/for (?:every|each)\s+/i)) return null;
  let every = 1;
  const n = r.eat(new RegExp(`(${NUM})(?=%)|(${NUM})\\s+`));
  if (n) every = num(n[1] ?? n[2]);
  let q: Quantity | null = null;
  let q2: Quantity | null = null;
  const sum = readSumQ(r, lookup, "target");
  if (sum) [q, q2] = sum;
  const st = sum ? null : r.status();
  if (sum) {
    /* done */
  } else if (st) {
    const info = lookup(st);
    const isCount = !!r.eat(/Count\b/i);
    const isPotency = !!r.eat(/Potency\b/i);
    let w: Who = "target";
    const on = r.eat(/(?:on|of|owned by|that)\s+(self|this unit|the target|target|the user|user)\b/i);
    if (on) w = who(on[1], "target");
    q = Q(isCount ? "statusCount" : isPotency || info.mode === "value" ? "statusPotency" : "statusPotency", { who: w, status: info.key, field: isCount ? "count" : "potency" });
  } else if (r.eat(/(?:Clash Count|Clash(?:es)?)\b/i)) q = Q("clashCount");
  else if (r.eat(/(?:Speed difference|difference in Speed)(?: (?:with|from|between)(?: this unit and)? (?:the )?target)?/i)) q = Q("speedDiff");
  else if (r.eat(/negative effects? on (?:the )?target/i) || r.eat(/type of negative effect on (?:the )?target/i)) q = Q("negativeEffects", { who: "target" });
  else if (r.eat(/(?:points? of )?SP\b/i)) q = Q("sp");
  else if (r.eat(/% of (?:this unit's )?missing HP|% missing HP(?: on self)?/i)) q = Q("missingHpPct");
  else if (r.eat(/Speed difference|difference in Speed/i)) q = Q("speedDiff");
  else if (r.eat(/Heads(?: Coins?)?(?: tossed)?/i)) q = Q("headsCount");
  else if (r.eat(/Tails(?: Coins?)?(?: tossed)?/i)) q = Q("tailsCount");
  else if (r.eat(/(?:dead|fallen|defeated) all(?:y|ies)/i)) q = Q("alliesDead");
  if (!q) {
    r.s = save;
    return null;
  }
  let max: number | null = null;
  const mx = r.eat(new RegExp(`\\((?:max\\.?|up to)\\s*(${NUM})%?\\)`, "i"));
  if (mx) max = num(mx[1]);
  return { per: { q, q2, every, amount: amountPer }, max };
}

function readMax(r: Reader): number | null {
  const mx = r.eat(new RegExp(`\\((?:max\\.?|up to)\\s*(${NUM})%?\\)`, "i"));
  return mx ? num(mx[1]) : null;
}

const POWER_STATS: Record<string, ModStat> = {
  "coin power": "coinPower",
  "base power": "basePower",
  "final power": "finalPower",
  "clash power": "clashPower",
  "skill power": "basePower",
  "offense level": "offenseLevel",
  "defense level": "defenseLevel",
  "attack weight": "atkWeight",
  speed: "speed",
};

/** One condition clause ("If target has 5+ Bleed", "At 3+ Poise", "Against Staggered targets") */
function readCondition(r: Reader, lookup: StatusLookup): Condition[] | null {
  const save = r.s;
  // If/When/At/Against ... , (comma)
  let m: RegExpExecArray | null;
  const statusCmp = (w0: Who): Condition[] | null => {
    let w = w0;
    // N+ X [Count] / X / N or more X
    const nPlus = r.eat(new RegExp(`(${NUM})\\+\\s*|(${NUM}) or more\\s+`, "i"));
    if (nPlus) {
      const sum = readSumQ(r, lookup, w);
      if (sum) return [C("compare", { who: w, q: sum[0], q2: sum[1], op: ">=", value: num(nPlus[1] ?? nPlus[2]) })];
    }
    const st = r.status();
    if (!st) return null;
    const info = lookup(st);
    const isCount = !!r.eat(/Count\b/i);
    r.eat(/Potency\b/i);
    const on = r.eat(/on (self|this unit|the target|target)\b/i);
    if (on) w = who(on[1], w);
    if (!nPlus) return [C("hasStatus", { who: w, status: info.key })];
    const v = num(nPlus[1] ?? nPlus[2]);
    return [C("compare", { who: w, q: Q(isCount ? "statusCount" : "statusPotency", { who: w, status: info.key, field: isCount ? "count" : "potency" }), op: ">=", value: v })];
  };
  if ((m = r.eat(/(?:if|when) (?:the )?target (?:has|is inflicted with)\s+/i)) || (m = r.eat(/against (?:a )?targets? with\s+/i)) || (m = r.eat(/(?:if|when) (?:the )?target's\s+(?=⟦)/i))) {
    const c = statusCmp("target");
    if (c && r.eat(/(?:,|\s+)/)) return c;
    r.s = save;
  }
  if ((m = r.eat(/(?:if|when) (?:this unit|self|the user|this character) (?:has|owns)\s+/i)) || (m = r.eat(/at\s+(?=[+-]?\d+\+\s*[⟦(])/i)) || (m = r.eat(/(?:if|when) (?:this unit|self)'s\s+(?=⟦)/i))) {
    const c = statusCmp("self");
    if (c && r.eat(/(?:,|\s+)/)) return c;
    r.s = save;
  }
  if (r.eat(/(?:if|when) (?:the )?target is Staggered,?|against Staggered targets,?|if the target is in a Staggered state,?/i)) {
    return [C("isStaggered", { who: "target" })];
  } else if (r.eat(/(?:if|when) this unit is Staggered,?/i)) {
    return [C("isStaggered", { who: "self" })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:this unit has|at) (${NUM})\\+ SP\\b,?|at (${NUM})\\+ SP\\b,?|if SP\\b is (${NUM}) or (?:more|higher),?`, "i")))) {
    return [C("compare", { who: "self", q: Q("sp"), op: ">=", value: num(m[1] ?? m[2] ?? m[3]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when|at) (?:this unit is at |this unit has )?(${NUM})% (?:HP )?or (?:less|lower|below)(?: HP)?,?|(?:if|when) (?:this unit's )?HP is (?:at |below |under )?(${NUM})% or (?:less|lower|below),?|at (${NUM})% HP or (?:less|lower),?`, "i")))) {
    return [C("compare", { who: "self", q: Q("hpPct"), op: "<=", value: num(m[1] ?? m[2] ?? m[3]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:the )?target(?:'s HP)? is (?:at )?(${NUM})% (?:HP )?or (?:less|lower|below)(?: HP)?,?|against targets? (?:at|with) (${NUM})% (?:HP )?or (?:less|lower)(?: HP)?,?`, "i")))) {
    return [C("compare", { who: "target", q: Q("hpPct", { who: "target" }), op: "<=", value: num(m[1] ?? m[2]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:at|this unit is at) less than (${NUM})% HP,?|(?:if|when) (?:this unit's )?HP is (?:less|lower) than (${NUM})%,?|at less than (${NUM})% HP,?`, "i")))) {
    return [C("compare", { who: "self", q: Q("hpPct"), op: "<", value: num(m[1] ?? m[2] ?? m[3]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:this unit's )?Speed is (?:faster|higher) than (?:the )?target's(?: Speed)? by (${NUM}) or more,?`, "i")))) {
    return [C("compare", { who: "self", q: Q("speedDiff"), op: ">=", value: num(m[1]) })];
  } else if ((m = r.eat(/(?:if|when) (?:this unit's )?Speed is (?:higher|faster) than (?:the )?target's(?: Speed)?,?|if faster than the target,?/i))) {
    return [C("compare", { who: "self", q: Q("speedDiff"), op: ">", value: 0 })];
  } else if ((m = r.eat(new RegExp(`(${NUM})% chance to\\s+`, "i")))) {
    return [C("chance", { value: num(m[1]) })];
  } else if (r.eat(/(?:if|when) this Skill (?:is|was) used as an Unopposed Attack,?|if Unopposed,?|on Unopposed Attack,?/i)) {
    return [C("unopposed")];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:the )?Clash Count is (${NUM})\\+,?|at (${NUM})\\+ Clash(?:es| Count),?`, "i")))) {
    return [C("compare", { who: "self", q: Q("clashCount"), op: ">=", value: num(m[1] ?? m[2]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:the )?target has (${NUM}) or (?:higher|more) SP\\b,?|(?:if|when) (?:the )?target(?:'s SP\\b)? is at (${NUM})\\+ SP\\b,?|against targets? (?:at|with) (${NUM})\\+ SP\\b,?`, "i")))) {
    return [C("compare", { who: "target", q: Q("sp", { who: "target" }), op: ">=", value: num(m[1] ?? m[2] ?? m[3]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:the )?target has less than (${NUM}) SP\\b,?|against targets? with less than (${NUM}) SP\\b,?`, "i")))) {
    return [C("compare", { who: "target", q: Q("sp", { who: "target" }), op: "<", value: num(m[1] ?? m[2]) })];
  } else if ((m = r.eat(new RegExp(`(?:if|when) (?:the )?target has (?:(${NUM})\\+ (?:types of )?negative effects|an?y? negative effects?),?`, "i")))) {
    return [C("compare", { who: "target", q: Q("negativeEffects", { who: "target" }), op: ">=", value: m[1] ? num(m[1]) : 1 })];
  } else if ((m = r.eat(new RegExp(`at (${NUM})\\+ Speed,?|(?:if|when) (?:this unit's )?Speed is (${NUM}) or (?:more|higher),?`, "i")))) {
    return [C("compare", { who: "self", q: Q("speed"), op: ">=", value: num(m[1] ?? m[2]) })];
  } else if (r.eat(/in a Clash,?\s*/i)) {
    return [];
  } else if ((m = r.eat(/(?:if|when) (?:the )?target has no\s+/i))) {
    const st = r.status();
    if (st && r.eat(/(?:,|\s+)/)) return [C("hasStatus", { who: "target", status: lookup(st).key, not: true })];
  } else if ((m = r.eat(/(?:if|when) this unit has no\s+/i))) {
    const st = r.status();
    if (st && r.eat(/(?:,|\s+)/)) return [C("hasStatus", { who: "self", status: lookup(st).key, not: true })];
  } else if ((m = r.eat(/(?:if|when) (?:the )?target is an? (?:enemy|Abnormality)?,?/i))) {
    return [];
  }
  r.s = save;
  return null;
}

interface ActCtx {
  where: Where;
  trigger: Trigger;
  lookup: StatusLookup;
}

/** Status amounts: "N X", "+N X Count", "N X and +N X Count", "N X Potency" */
function readStatusAmount(r: Reader, lookup: StatusLookup): { key: string; mode: "pc" | "value"; potency: number; count: number } | null {
  const save = r.s;
  const n = r.eat(new RegExp(`(${NUM})\\s+`));
  if (!n) return null;
  const st = r.status();
  if (!st) {
    r.s = save;
    return null;
  }
  const info = lookup(st);
  const isCount = !!r.eat(/Count\b/i);
  r.eat(/Potency\b/i);
  const v = num(n[1]);
  let potency = 0;
  let count = 0;
  if (info.mode === "value") count = v;
  else if (isCount) count = v;
  else potency = v;
  // "and +N X Count" for the same status
  const save2 = r.s;
  const m2 = r.eat(new RegExp(`and (${NUM})\\s+`, "i"));
  if (m2) {
    const st2 = r.status();
    if (st2 === st && r.eat(/Count\b/i)) count += num(m2[1]);
    else r.s = save2;
  }
  return { key: info.key, mode: info.mode, potency, count };
}

function readTimingAndWho(r: Reader, dflt: Who): { timing: "now" | "nextTurn"; who: Who; count: number } {
  let timing: "now" | "nextTurn" = "now";
  let w = dflt;
  let count = 1;
  for (let i = 0; i < 3; i++) {
    if (r.eat(/next turn\b/i)) timing = "nextTurn";
    else if (r.eat(/this turn\b/i)) timing = "now";
    let m: RegExpExecArray | null;
    if (r.eat(/(?:to|on|for) this Skill(?:'s)? Slot\b/i)) w = "self";
    else if ((m = r.eat(/(?:on|to|for)\s+(self|this unit|the user|user|all allies|other allies|all other allies|all enemies|every enemy|a random enemy|a random ally|the target|target|the ally with the lowest HP|the ally with the lowest SP\b)\b/i))) w = who(m[1], dflt);
    else if ((m = r.eat(/(?:on|to)\s+(\d+) random (enem(?:y|ies)|all(?:y|ies))\b/i))) {
      w = m[2].toLowerCase().startsWith("enem") ? "randomEnemy" : "randomAlly";
      count = Number(m[1]);
    }
  }
  return { timing, who: w, count };
}

function readAction(r: Reader, c: ActCtx): Action[] | null {
  const { lookup } = c;
  const save = r.s;
  let m: RegExpExecArray | null;

  // Inflict N X [and +N X Count] [next turn] [on ...]
  if ((m = r.eat(/inflict\s+/i))) {
    const parts: Action[] = [];
    for (;;) {
      const a = readStatusAmount(r, lookup);
      if (!a) break;
      if (r.eat(/this turn and next turn\b/i)) {
        parts.push(A("inflict", { status: a.key, potency: V(a.potency), amount: V(a.count), timing: "now" }));
        parts.push(A("inflict", { status: a.key, potency: V(a.potency), amount: V(a.count), timing: "nextTurn" }));
        if (!r.eat(/(?:,\s*)?and\s+(?=[+-]?\d)/i)) break;
        continue;
      }
      const tw = readTimingAndWho(r, "target");
      parts.push(A("inflict", { status: a.key, potency: V(a.potency), amount: V(a.count), timing: tw.timing, who: tw.who, count: tw.count }));
      if (!r.eat(/(?:,\s*)?and\s+(?=[+-]?\d)/i) && !r.eat(/,\s*(?=[+-]?\d)/)) break;
    }
    if (parts.length) {
      // a trailing "next turn" applies to every listed status
      const tw = readTimingAndWho(r, "target");
      if (tw.timing === "nextTurn") for (const p of parts) p.timing = "nextTurn";
      if (tw.who !== "target") for (const p of parts) p.who = tw.who;
      return parts;
    }
    r.s = save;
    return null;
  }
  // Apply N X to <who> [next turn]  (wording used for allies / several targets)
  if ((m = r.eat(/apply\s+/i))) {
    const parts: Action[] = [];
    for (;;) {
      const a = readStatusAmount(r, lookup);
      if (!a) break;
      parts.push(A("inflict", { status: a.key, potency: V(a.potency), amount: V(a.count) }));
      if (!r.eat(/(?:,\s*)?and\s+(?=[+-]?\d)/i) && !r.eat(/,\s*(?=[+-]?\d)/)) break;
    }
    if (!parts.length) {
      r.s = save;
      return null;
    }
    let w: Who = "target";
    let count = 1;
    let timing: "now" | "nextTurn" = "now";
    for (let i = 0; i < 3; i++) {
      let mm: RegExpExecArray | null;
      if (r.eat(/next turn\b/i)) timing = "nextTurn";
      else if (r.eat(/this turn\b/i)) timing = "now";
      else if ((mm = r.eat(/to (\d+) all(?:y|ies) placed after this unit(?: on the Dashboard)?/i))) {
        w = "alliesAfterSelf";
        count = Number(mm[1]);
      } else if ((mm = r.eat(/to (?:the )?(\d+)? ?all(?:y|ies) with the lowest HP/i))) {
        w = "lowestHpAlly";
        count = Number(mm[1] ?? 1);
      } else if ((mm = r.eat(/to (?:the )?(\d+)? ?all(?:y|ies) with the lowest SP/i))) {
        w = "lowestSpAlly";
        count = Number(mm[1] ?? 1);
      } else if ((mm = r.eat(/to (\d+) random (enem(?:y|ies)|all(?:y|ies))/i))) {
        w = mm[2].toLowerCase().startsWith("enem") ? "randomEnemy" : "randomAlly";
        count = Number(mm[1]);
      } else if ((mm = r.eat(/(?:to|on) (self|this unit|all allies|other allies|all other allies|all enemies|the target|target|a random ally|a random enemy)\b/i))) w = who(mm[1], "target");
      else break;
    }
    for (const p of parts) {
      p.who = w;
      p.count = count;
      p.timing = timing;
    }
    return parts;
  }
  // Consume N X (Count) to gain …  →  only when there is enough to consume
  if ((m = r.eat(new RegExp(`(?:consume|spend)s? (${NUM})\\s+(?=⟦)`, "i")))) {
    const st = r.status();
    if (st && r.peek(/(?:Count|Potency)?\s*(?:on self\s*)?to\s+/i)) {
      const info = lookup(st);
      const isCount = !!r.eat(/Count\b/i);
      r.eat(/Potency\b/i);
      r.eat(/on self\s*/i);
      r.eat(/to\s+/i);
      const rest = readAction(r, c);
      if (rest) {
        const n = num(m[1]);
        const field = isCount || info.mode === "value" ? "count" : "potency";
        const reduce = A("reduceStatus", { who: "self", status: info.key, field, amount: V(n) });
        (reduce as Action & { _require?: Condition })._require = C("compare", { who: "self", q: Q(field === "count" ? "statusCount" : "statusPotency", { who: "self", status: info.key, field }), op: ">=", value: n });
        return [reduce, ...rest];
      }
    }
    r.s = save;
  }
  // "gain Coin Power +1" = "Coin Power +1"
  if (r.eat(/gains?\s+(?=(?:coin|base|final|clash|skill) power|offense level|defense level|attack weight)/i)) return readAction(r, c);
  // Gain N X [and +N X Count] [next turn]
  if ((m = r.eat(/gain(?:s)?\s+/i))) {
    const parts: Action[] = [];
    for (;;) {
      const a = readStatusAmount(r, lookup);
      if (!a) break;
      const tw = readTimingAndWho(r, "self");
      parts.push(A("inflict", { status: a.key, potency: V(a.potency), amount: V(a.count), timing: tw.timing, who: tw.who === "target" ? "self" : tw.who, count: tw.count }));
      if (!r.eat(/(?:,\s*)?and\s+(?=[+-]?\d)/i) && !r.eat(/,\s*(?=[+-]?\d)/)) break;
    }
    if (parts.length) {
      const tw = readTimingAndWho(r, "self");
      if (tw.timing === "nextTurn") for (const p of parts) p.timing = "nextTurn";
      if (tw.who !== "self" && tw.who !== "target") for (const p of parts) p.who = tw.who;
      return parts;
    }
    // Gain N Shield
    const sh = r.eat(new RegExp(`(${NUM})\\s+Shield(?: HP)?`, "i"));
    if (sh) return [A("shield", { who: "self", amount: V(num(sh[1])) })];
    const shp = r.eat(new RegExp(`Shield equal to (${NUM})% of (?:this unit's )?max(?:imum)? HP`, "i"));
    if (shp) return [A("shield", { who: "self", amount: V(num(shp[1])), hpMode: "pctMax" })];
    r.s = save;
    return null;
  }
  // Coin Power +N / Base Power +N / Final Power -N / Clash Power +N [for every ...] [(max N)]
  if ((m = r.eat(new RegExp(`(coin power|base power|final power|clash power|skill power|offense level|defense level|attack weight)\\s*(${NUM})`, "i")))) {
    const stat = POWER_STATS[m[1].toLowerCase()];
    const n = num(m[2]);
    const perv = readPer(r, n, lookup);
    const amount: Value = perv ? { base: 0, per: perv.per, min: null, max: perv.max } : V(n);
    if (!perv) {
      const mx = readMax(r);
      if (mx !== null) amount.max = mx;
    }
    if (perv && perv.max !== null && n < 0) {
      amount.min = -Math.abs(perv.max);
      amount.max = null;
    }
    const tw = readTimingAndWho(r, "self");
    return [A("mod", { stat, amount, who: "self", scope: tw.timing === "nextTurn" ? "nextTurn" : "skill" })];
  }
  // Deal +N% damage / Deal -N% damage / Deal N% more damage [for every …]
  if ((m = r.eat(new RegExp(`deals?\\s+(${NUM})% (?:more |less |additional )?damage`, "i")))) {
    let n = num(m[1]);
    if (/less damage/i.test(m[0])) n = -Math.abs(n);
    const perv = readPer(r, n, lookup);
    const amount: Value = perv ? { base: 0, per: perv.per, min: null, max: perv.max } : V(n);
    if (r.eat(/on Critical Hits?\b/i)) return [A("mod", { stat: "critDmg", amount, who: "self" })];
    const tw = readTimingAndWho(r, "self");
    return [A("mod", { stat: "dmgDealt", amount, who: "self", scope: tw.timing === "nextTurn" ? "nextTurn" : "skill" })];
  }
  // "+N% Damage" (short form)
  if ((m = r.eat(new RegExp(`(${NUM})% (?:damage|DMG)(?! on Critical)(?! taken)`, "i")))) {
    const n = num(m[1]);
    const perv = readPer(r, n, lookup);
    const amount: Value = perv ? { base: 0, per: perv.per, min: null, max: perv.max } : V(n);
    return [A("mod", { stat: "dmgDealt", amount, who: "self" })];
  }
  // Take -N% damage from Bleed / Damage taken from Bleed -N%
  if ((m = r.eat(new RegExp(`takes?\\s+(${NUM})% (?:more |less )?damage from\\s+(?=⟦)`, "i")))) {
    const st = r.status();
    if (st) {
      let n = num(m[1]);
      if (/less damage/i.test(m[0])) n = -Math.abs(n);
      return [A("mod", { stat: "statusDmgTaken", status: lookup(st).key, amount: V(n), who: "self", scope: "turn" })];
    }
    r.s = save;
    return null;
  }
  if ((m = r.eat(/damage taken from\s+(?=⟦)/i))) {
    const st = r.status();
    const v = st ? r.eat(new RegExp(`(${NUM})%`)) : null;
    if (st && v) return [A("mod", { stat: "statusDmgTaken", status: lookup(st).key, amount: V(num(v[1])), who: "self", scope: "turn" })];
    r.s = save;
    return null;
  }
  // Reduce Sinking Count on target by N
  if ((m = r.eat(/(?:reduce|lower)s?\s+(?=⟦)/i))) {
    const st = r.status();
    if (st) {
      const info = lookup(st);
      const isCount = !!r.eat(/Count\b/i);
      r.eat(/Potency\b/i);
      const on = r.eat(/(?:on|of) (the target|target|self|this unit)\s*/i);
      const by = r.eat(new RegExp(`by (${NUM})`, "i"));
      if (by) return [A("reduceStatus", { who: on ? who(on[1], "target") : "target", status: info.key, field: isCount || info.mode === "value" ? "count" : "potency", amount: V(num(by[1])) })];
    }
    r.s = save;
    return null;
  }
  // +N% Damage on Critical Hit
  if ((m = r.eat(new RegExp(`(${NUM})% (?:damage|DMG) on Critical Hits?`, "i")))) return [A("mod", { stat: "critDmg", amount: V(num(m[1])), who: "self" })];
  // Take -N% damage
  if ((m = r.eat(new RegExp(`takes?\\s+(${NUM})% (?:more |less )?damage`, "i")))) {
    let n = num(m[1]);
    if (/less damage/i.test(m[0])) n = -Math.abs(n);
    const perv = readPer(r, n, lookup);
    const amount: Value = perv ? { base: 0, per: perv.per, min: null, max: perv.max } : V(n);
    const tw = readTimingAndWho(r, "self");
    return [A("mod", { stat: "dmgTaken", amount, who: "self", scope: tw.timing === "nextTurn" ? "nextTurn" : c.where === "skill" || c.where === "coin" ? "turn" : "skill" })];
  }
  // Heal N SP / Lose N SP / Deal N SP damage / Heal N HP / Take N damage
  if ((m = r.eat(new RegExp(`heals?\\s+(${NUM})\\s+SP\\b`, "i")))) {
    const tw = readTimingAndWho(r, "self");
    return [A("healSp", { who: tw.who === "target" && !/on (the )?target/i.test(save) ? "self" : tw.who, amount: V(num(m[1])), count: tw.count })];
  }
  if ((m = r.eat(new RegExp(`loses?\\s+(${NUM})\\s+SP\\b`, "i")))) {
    const tw = readTimingAndWho(r, "self");
    return [A("loseSp", { who: tw.who === "target" ? "self" : tw.who, amount: V(num(m[1])), count: tw.count })];
  }
  if ((m = r.eat(new RegExp(`deals?\\s+(${NUM})\\s+SP\\b damage`, "i")))) {
    const tw = readTimingAndWho(r, "target");
    return [A("loseSp", { who: tw.who, amount: V(num(m[1])), count: tw.count })];
  }
  if ((m = r.eat(new RegExp(`heals?\\s+(?:by\\s+)?(${NUM})% of (?:the )?damage dealt`, "i")))) {
    const pct = num(m[1]);
    return [A("healHp", { who: "self", amount: { base: 0, per: { q: Q("damageDealt"), q2: null, every: 100 / pct, amount: 1 }, min: null, max: null } })];
  }
  if ((m = r.eat(new RegExp(`heals?\\s+(${NUM})% of (?:this unit's |its |their )?max(?:imum)? HP`, "i")))) {
    const tw = readTimingAndWho(r, "self");
    return [A("healHp", { who: tw.who === "target" ? "self" : tw.who, amount: V(num(m[1])), hpMode: "pctMax" })];
  }
  if ((m = r.eat(new RegExp(`heals?\\s+(${NUM})% of (?:this unit's |its )?missing HP`, "i")))) return [A("healHp", { who: "self", amount: V(num(m[1])), hpMode: "pctMissing" })];
  if ((m = r.eat(new RegExp(`heals?\\s+(${NUM})\\s+HP`, "i")))) {
    const tw = readTimingAndWho(r, "self");
    return [A("healHp", { who: tw.who === "target" ? "self" : tw.who, amount: V(num(m[1])), count: tw.count })];
  }
  if ((m = r.eat(new RegExp(`(?:take|lose)s?\\s+(${NUM})\\s+(?:fixed\\s+)?(?:damage|HP)`, "i")))) return [A("loseHp", { who: "self", amount: V(num(m[1])) })];
  if ((m = r.eat(new RegExp(`(?:take|lose)s?\\s+(${NUM})% of (?:this unit's |its )?max(?:imum)? HP(?: as fixed damage)?`, "i")))) return [A("loseHp", { who: "self", amount: V(num(m[1])), hpMode: "pctMax" })];
  // Deal N (fixed) (Sin|Type) damage
  if ((m = r.eat(new RegExp(`(?:deals?|inflicts?)\\s+(${NUM})\\s+(?:fixed\\s+)?(?:HP\\s+)?(?:(slash|pierce|blunt|wrath|lust|sloth|gluttony|gloom|pride|envy)(?:-affinity)?\\s+)?(?:bonus\\s+)?damage`, "i")))) {
    const k = m[2]?.toLowerCase();
    const tw = readTimingAndWho(r, "target");
    return [A("fixedDamage", { who: tw.who, amount: V(num(m[1])), sin: k && SIN_WORDS[k] ? SIN_WORDS[k] : null, dmgType: k && DMG_WORDS[k] ? DMG_WORDS[k] : null, count: tw.count })];
  }
  // Activate / Trigger a status: "Activate ⟦Bleed⟧ on target once", "Activate the target's ⟦Bleed⟧", "Trigger ⟦Burn⟧ on self twice"
  if ((m = r.eat(/(?:activate|trigger)s?\s+(?:(?:the\s+)?(target|this unit|self)'s\s+)?(?=⟦)/i))) {
    const st = r.status();
    if (st) {
      const on = r.eat(/on\s+(?:the\s+)?(target|this unit|self|itself)\b/i);
      const times = r.eat(/(?:(\d+)\s+times?|once|twice)\b/i);
      const n = times ? (times[1] ? Number(times[1]) : /twice/i.test(times[0]) ? 2 : 1) : 1;
      return [A("triggerStatus", { who: who(on ? on[1] : m[1], "target"), status: lookup(st).key, amount: V(n) })];
    }
    r.s = save;
    return null;
  }
  // Trigger Tremor Burst [N times]
  if ((m = r.eat(/trigger(?:s)? (?:a )?Tremor Burst(?: on (?:the )?(target|all enemies|self))?/i))) {
    const times = r.eat(/(\d+) times|twice/i);
    return [A("tremorBurst", { who: who(m[1], "target"), amount: V(times ? (times[1] ? Number(times[1]) : 2) : 1) })];
  }
  // Raise Stagger Threshold by N / by N% of damage dealt
  if ((m = r.eat(new RegExp(`raises? (?:the )?(?:target's )?Stagger Threshold by (${NUM})%? of (?:the )?damage dealt`, "i")))) {
    const pct = num(m[1]);
    return [A("raiseStaggerThreshold", { who: "target", amount: { base: 0, per: { q: Q("damageDealt"), q2: null, every: 100 / pct, amount: 1 }, min: null, max: null } })];
  }
  if ((m = r.eat(new RegExp(`raises? (?:the )?(?:target's )?Stagger Threshold by (${NUM})(?!%)`, "i")))) return [A("raiseStaggerThreshold", { who: "target", amount: V(num(m[1])) })];
  // reduce / consume / spend / lose statuses
  if ((m = r.eat(new RegExp(`(?:reduce|lower)s? (?:the )?(target|this unit|self)'s\\s+(?=⟦)`, "i")))) {
    const st = r.status();
    if (st) {
      const info = lookup(st);
      const isCount = !!r.eat(/Count\b/i);
      r.eat(/Potency\b/i);
      const by = r.eat(new RegExp(`by (${NUM})`, "i"));
      if (by) return [A("reduceStatus", { who: who(m[1], "target"), status: info.key, field: isCount || info.mode === "value" ? "count" : "potency", amount: V(num(by[1])) })];
    }
    r.s = save;
    return null;
  }
  if ((m = r.eat(/(target|this unit|self)?\s*(?:consumes?|spends?|loses?|uses?)\s+/i))) {
    const w: Who = m[1] && /target/i.test(m[1]) ? "target" : "self";
    const n = r.eat(new RegExp(`(${NUM})\\s+`));
    const st = n ? r.status() : null;
    if (n && st) {
      const info = lookup(st);
      const isCount = !!r.eat(/Count\b/i);
      r.eat(/Potency\b/i);
      return [A("reduceStatus", { who: w, status: info.key, field: isCount || info.mode === "value" ? "count" : "potency", amount: V(num(n[1])) })];
    }
    if (r.eat(/all\s+/i)) {
      const st2 = r.status();
      if (st2) return [A("removeStatus", { who: w, status: lookup(st2).key })];
    }
    r.s = save;
  }
  // Remove all X from ...
  if ((m = r.eat(/remove(?:s)? all\s+/i))) {
    const st = r.status();
    if (st) {
      const tw = readTimingAndWho(r, "target");
      return [A("removeStatus", { who: tw.who, status: lookup(st).key })];
    }
    r.s = save;
    return null;
  }
  // Amplitude Conversion / Entanglement
  if ((m = r.eat(/trigger(?:s)? Amplitude (Conversion|Entanglement) (?:into|to)\s+⟦?Tremor - (Decay|Fracture|Reverb|Everlasting|Chain|Scorch|Hemorrhage)⟧?/i))) {
    return [A("convertTremor", { who: "target", tremorType: m[2].toUpperCase() as Action["tremorType"], entangle: m[1].toLowerCase() === "entanglement" })];
  }
  // Target loses N SP
  if ((m = r.eat(new RegExp(`(?:the )?target loses (${NUM}) SP\\b`, "i")))) return [A("loseSp", { who: "target", amount: V(num(m[1])) })];
  // Lower this unit's Stagger Threshold by N
  if ((m = r.eat(new RegExp(`lowers? (?:the )?(?:user's|this unit's|own) Stagger Threshold by (${NUM})(?!%)`, "i")))) return [A("raiseStaggerThreshold", { who: "self", amount: V(-num(m[1])) })];
  // damage from this Skill cannot Stagger
  if (r.eat(/(?:the )?damage (?:dealt )?(?:by|from|of) this Skill (?:cannot|can't|does not|doesn't|will not) Stagger(?: the target)?|this Skill(?:'s damage)? (?:cannot|can't|does not) Stagger(?: the target)?/i))
    return [A("mod", { stat: "cannotStagger" as ModStat, amount: V(1), who: "self" })];
  // Reuse this Coin (once per Skill/turn)
  if (r.eat(/reuse (?:this |the )?coin\b/i)) {
    let n = 1;
    let perUse = 0;
    const word = (w: string, d: string | undefined) => (/^once$/i.test(w) ? 1 : /^twice$/i.test(w) ? 2 : Number(d));
    const inl = r.eat(/(once|twice|(\d+) times?)(?!\s*(?:per|max))/i);
    if (inl) {
      n = word(inl[1], inl[2]);
      perUse = 1;
    }
    const q = r.eat(/\((?:(once|twice|(\d+) times?)(?: max)?(?: per skill)?|max(?:imum)? (\d+) times?(?: per skill)?)\)/i);
    if (q) {
      if (q[3]) perUse = Number(q[3]);
      else if (/per skill|max/i.test(q[0])) perUse = word(q[1], q[2]);
      else {
        n = word(q[1], q[2]);
        perUse = 1;
      }
    }
    const a = A("reuseCoin", { amount: V(n) });
    if (perUse) (a as Action & { _perUse?: number })._perUse = perUse;
    return [a];
  }
  // Gain N <sin> E.G.O Resource(s)
  if ((m = r.eat(new RegExp(`gain (${NUM}) (wrath|lust|sloth|gluttony|gloom|pride|envy) (?:E\\.G\\.O )?resources?`, "i")))) return [A("gainResource", { sin: SIN_WORDS[m[2].toLowerCase()], amount: V(num(m[1])) })];
  return null;
}

// ---------------------------------------------------------------------------------
// Sentence → effect
// ---------------------------------------------------------------------------------
function parseSentence(text0: string, trig: Trigger, where: Where, lookup: StatusLookup): Partial2 | null {
  let text = text0;
  if (where === "gift") {
    // a gift runs once for every ally, so "all allies gain X" is "(each ally) gains X"
    text = text
      .replace(/\ball allies (gain|deal|take|heal|lose)\b/gi, "$1")
      .replace(/^(?:allies'|ally) skills /i, "")
      .replace(/^skills deal (\S+) damage (?:to|against) Staggered enemies/i, "Against Staggered targets, deal $1 damage");
  }
  const r = new Reader(text.trim().replace(/^[-•]\s*/, "").replace(/^(?:then|and|also),?\s+/i, ""), lookup);
  const out: Partial2 = { conditions: [], actions: [] };
  // Entry / Starting SP
  {
    const m = r.eat(new RegExp(`(?:entry|starting|start(?:ing)? encounter with|encounter start:? (?:gain|heal)?)\\s*SP\\b\\s*(${NUM})`, "i"));
    if (m && r.done) return { conditions: [], actions: [A("healSp", { who: "self", amount: V(num(m[1])) })], trigger: "encounterStart" };
    if (m) return null;
  }
  // unit-level "Combat Start:" style prefixes inside passives/gifts
  const unitTrig = r.eat(/(combat start|turn start|turn end|at the start of (?:the |each |every )?turn|at the end of (?:the |each |every )?turn|at turn (?:start|end)|at (?:the )?start of (?:the )?(?:battle|encounter|combat)|on encounter start|when (?:this unit is )?hit by an attack(?: skill)?|when (?:this unit is )?hit|when hit by attack skills|on clash win|on clash lose|after winning a clash|after losing a clash|on kill|after (?:killing|defeating) (?:an|1|one) enem(?:y|ies)|when an ally dies|on ally death|on hit|when hitting an enemy(?: with (?:an attack |a )?skill)?|after attacking|on evade|when an ally is (?:defeated|killed)|upon clash (?:lose|win)|encounter start)\s*[:,]?\s*/i);
  if (unitTrig) {
    const k = unitTrig[1].toLowerCase();
    out.trigger = /combat start|start of (?:the )?combat/.test(k) ? "combatStart"
      : /turn start|start of (?:the |each |every )?turn/.test(k) ? "turnStart"
      : /turn end|end of (?:the |each |every )?turn/.test(k) ? "turnEnd"
      : /battle|encounter/.test(k) ? "encounterStart"
      : /upon clash lose/.test(k) ? (where === "skill" ? "clashLose" : "onClashLoseAny")
      : /upon clash win/.test(k) ? (where === "skill" ? "clashWin" : "onClashWinAny")
      : /ally is (?:defeated|killed)/.test(k) ? "onAllyDeath"
      : /^on hit$|hitting an enemy/.test(k) ? (where === "skill" || where === "coin" ? "onHit" : "onHitDealt")
      : /hit/.test(k) ? "whenHit"
      : /clash win|winning a clash/.test(k) ? (where === "skill" ? "clashWin" : "onClashWinAny")
      : /clash lose|losing a clash/.test(k) ? (where === "skill" ? "clashLose" : "onClashLoseAny")
      : /kill|defeat/.test(k) ? (where === "skill" || where === "coin" ? "onKill" : "onKillAny")
      : /after attacking/.test(k) ? (where === "skill" ? "attackEnd" : "onSkillUse")
      : /evade/.test(k) ? "onEvade"
      : "onAllyDeath";
    if (where === "skill" || where === "coin") {
      const ok: Trigger[] = ["combatStart", "turnEnd", "turnStart", "onHit", "clashWin", "clashLose", "onKill", "attackEnd", "onEvade"];
      if (!ok.includes(out.trigger)) return null;
    }
    // gift wording: "When hitting an enemy with a Skill that inflicts Bleed Potency, ..."
    const inf = r.eat(/(?:using |with )?a skill that inflicts\s+/i);
    if (inf) {
      const st = r.status();
      if (!st) return null;
      r.eat(/(?:Potency|Count)\b/i);
      out.conditions.push(C("skillInflicts", { status: lookup(st).key }));
      r.eat(/,\s*/);
    }
    const aff = r.eat(/(?:using |with )?an? (wrath|lust|sloth|gluttony|gloom|pride|envy) affinity (?:attack )?skill,?\s*/i);
    if (aff) out.conditions.push(C("skillSin", { sin: SIN_WORDS[aff[1].toLowerCase()] }));
  }
  for (let i = 0; i < 3; i++) {
    const c = readCondition(r, lookup);
    if (!c) break;
    out.conditions.push(...c);
  }
  const ctx: ActCtx = { where, trigger: out.trigger ?? trig, lookup };
  for (let guard = 0; guard < 8; guard++) {
    const a = readAction(r, ctx);
    if (!a) return null;
    for (const x of a) {
      const pu = (x as Action & { _perUse?: number })._perUse;
      if (pu) {
        out.perUse = pu;
        delete (x as Action & { _perUse?: number })._perUse;
      }
      const req = (x as Action & { _require?: Condition })._require;
      if (req) {
        out.conditions.push(req);
        delete (x as Action & { _require?: Condition })._require;
      }
    }
    out.actions.push(...a);
    // qualifiers
    for (let k = 0; k < 3; k++) {
      let tm: RegExpExecArray | null;
      if (r.eat(/\(once per skill\)|once per skill/i)) out.perUse = 1;
      else if ((tm = r.eat(/\((?:max(?:imum)? )?(\d+) times?(?: max)? per skill\)|(\d+) times per skill/i))) out.perUse = Number(tm[1] ?? tm[2]);
      else if (r.eat(/\(once per turn\)|once per turn/i)) out.perTurn = 1;
      else if ((tm = r.eat(/\(?(\d+) times per turn\)?/i))) out.perTurn = Number(tm[1]);
      else if ((tm = r.eat(/\(?(?:max(?:imum)?\s*)?(\d+) times per (?:encounter|battle)\)?/i))) out.perEncounter = Number(tm[1]);
      else if (r.eat(/\(once per (?:encounter|battle)\)|once per encounter/i)) out.perEncounter = 1;
      else if (r.eat(/\((?:only )?once\)/i)) out.perEncounter = out.perEncounter ?? 0;
      else break;
    }
    {
      const tm = r.eat(/(?:against|to|vs\.?) (?:targets?|enemies|units) with\s+(?=[+-]?\d|⟦)/i);
      if (tm) {
        const nPlus = r.eat(new RegExp(`(${NUM})\\+\\s*`));
        const st = r.status();
        if (!st) return null;
        const info = lookup(st);
        const isCount = !!r.eat(/Count\b/i);
        out.conditions.push(
          nPlus
            ? C("compare", { who: "target", q: Q(isCount ? "statusCount" : "statusPotency", { who: "target", status: info.key, field: isCount ? "count" : "potency" }), op: ">=", value: num(nPlus[1]) })
            : C("hasStatus", { who: "target", status: info.key }),
        );
      }
    }
    if (r.done) break;
    if (r.eat(/(?:,|;)?\s*(?:and|then|,|;)\s*(?:then,?\s*)?/i)) continue;
    return null;
  }
  if (!r.done || !out.actions.length) return null;
  // a random chance to Reuse is not simulated as such: keep it as a note
  if (out.actions.some((a) => a.kind === "reuseCoin") && out.conditions.some((c) => c.kind === "chance")) return null;
  return out;
}

function splitSentences(line: string): string[] {
  // split on ". " / "; " but keep parentheses and ⟦status names⟧ together
  const out: string[] = [];
  let depth = 0;
  let mark = 0;
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "⟦") mark++;
    if (ch === "⟧") mark = Math.max(0, mark - 1);
    if (!mark && ch === "(") depth++;
    if (!mark && ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && mark === 0 && (ch === "." || ch === ";") && (i === line.length - 1 || /\s/.test(line[i + 1])) && !/(?:E\.G|Corp|Assoc|No|vs|St|Lv)$/.test(cur)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  // "(rounded down)", "(Max 3)", "(Once per turn)" belong to the sentence before
  const merged: string[] = [];
  for (const x of out) {
    if (merged.length && /^\([^)]*\)\.?$/.test(x)) merged[merged.length - 1] += " " + x;
    else merged.push(x);
  }
  return merged;
}

/** Ids are assigned by the importer; here they are placeholders. */
function toEffect(p: Partial2, trigger: Trigger, sentence: string): Effect {
  return {
    id: "",
    trigger,
    conditions: p.conditions,
    actions: p.actions,
    perTurn: p.perTurn ?? 0,
    perEncounter: p.perEncounter ?? 0,
    perUse: p.perUse ?? 0,
    text: sentence.length <= 400 ? sentence : sentence.slice(0, 397) + "…",
  };
}

/** Effects that only change numbers for this coin/skill are applied while it is calculated. */
function finalizeTrigger(trigger: Trigger, p: Partial2, where: Where): { trigger: Trigger; extra: Condition[] } {
  const onlyMods = p.actions.every((a) => a.kind === "mod" && ["dmgDealt", "critDmg", "coinPower", "finalPower", "clashPower", "basePower"].includes(a.stat));
  if (!onlyMods) return { trigger, extra: [] };
  if (where === "coin") {
    if (trigger === "onHit") return { trigger: "always", extra: [] };
    if (trigger === "headsHit") return { trigger: "always", extra: [C("isHeads")] };
    if (trigger === "tailsHit") return { trigger: "always", extra: [C("isTails")] };
    if (trigger === "onCrit") return { trigger: "always", extra: [C("isCrit")] };
  }
  if (where === "skill" && trigger === "always") return { trigger, extra: [] };
  return { trigger, extra: [] };
}

/**
 * Convert one block of effect text (a skill's `se`, a coin's `ce`, a passive's text…).
 * `where` sets the default trigger: skills/coins without a bracket label are
 * "always" modifiers; passives and gifts default to "always" too.
 */
export function convert(text: string, where: Where, lookup: StatusLookup): Converted {
  const res: Converted = { effects: [], notes: [], flags: {}, sentences: 0, parsed: 0, info: 0 };
  const lines = prep(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let lineTrigger: Trigger | null = null;
  let lineExtra: Condition[] = [];
  for (const raw of lines) {
    let line = raw;
    const isBullet = /^[-•]/.test(line);
    let trig: Trigger | null = isBullet ? lineTrigger : null;
    let extra: Condition[] = isBullet ? lineExtra : [];
    let flagOnly = true;
    // leading [Trigger] labels
    for (;;) {
      const m = /^\[([^\]]+)\]\s*/.exec(line);
      if (!m) break;
      const label = m[1].trim().toLowerCase();
      if (FLAG_BRACKETS.has(label)) {
        if (label === "indiscriminate") res.flags.indiscriminate = true;
        if (label === "unclashable") res.flags.unclashable = true;
        if (label === "clashable counter") {
          res.flags.counter = true;
          res.flags.clashable = true;
        }
        if (label === "clashable guard") res.flags.clashable = true;
      } else if (BRACKET_EXTRA[label.replace(/\s*[–—]\s*/g, " - ")]) {
        const be = BRACKET_EXTRA[label.replace(/\s*[–—]\s*/g, " - ")];
        trig = be.trigger;
        extra = be.conds();
        flagOnly = false;
      } else if (BRACKET_TRIGGERS[label]) {
        trig = BRACKET_TRIGGERS[label];
        flagOnly = false;
      } else {
        trig = null;
        flagOnly = false;
        line = "\u0000" + line; // unknown trigger: keep as note
        break;
      }
      line = line.slice(m[0].length);
    }
    if (!isBullet) {
      lineTrigger = trig;
      lineExtra = extra;
    }
    const plain = line.replace(/\u0000/g, "").trim();
    if (!plain) {
      if (!flagOnly || !trig) continue;
      continue;
    }
    if (/^unbreakable coins?\.?$/i.test(plain)) {
      res.flags.unbreakable = true;
      continue;
    }
    if (/^excision coins?\.?$/i.test(plain)) {
      res.flags.excision = true;
      continue;
    }
    if (/^clashable guard\.?$/i.test(plain)) {
      res.flags.clashable = true;
      continue;
    }
    if (/^clashable counter\.?$/i.test(plain)) {
      res.flags.counter = true;
      res.flags.clashable = true;
      continue;
    }
    if (line.startsWith("\u0000")) {
      if (isInfo(plain)) res.info++;
      else res.sentences++;
      res.notes.push(display(raw));
      continue;
    }
    for (const sentence of splitSentences(plain)) {
      const t: Trigger = trig ?? "always";
      const p = parseSentence(sentence, t, where, lookup);
      if (!p) {
        if (isInfo(sentence)) res.info++;
        else res.sentences++;
        res.notes.push(display((trig && !isBullet ? `[${labelOf(raw)}] ` : "") + sentence));
        continue;
      }
      res.sentences++;
      const base = p.trigger ?? t;
      const fin = finalizeTrigger(base, p, where);
      p.conditions.push(...fin.extra, ...extra.map((c) => ({ ...c })));
      res.effects.push(toEffect(p, fin.trigger, display((trig ? `[${labelOf(raw)}] ` : "") + sentence)));
      res.parsed++;
    }
  }
  return res;
}

function labelOf(raw: string): string {
  const m = /^\[([^\]]+)\]/.exec(raw.replace(/^[-•]\s*/, ""));
  return m ? m[1] : "";
}

/** Remove the parser's status markers for display. */
export function display(s: string): string {
  return s.replace(/⟦([^⟧]+)⟧/g, "$1").replace(/\u0000/g, "").trim();
}
