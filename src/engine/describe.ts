// Turns effect rules into game-style text, e.g. "[On Hit] Inflict 2 Burn".
import { DMG_LABEL, SIN_LABEL } from "./constants";
import type { Action, Condition, Effect, Quantity, Trigger, Value, Who } from "../data/schema";
import { BUILTIN_STATUSES, TREMOR_TYPE_INFO } from "./statuses";

export type NameOf = (statusKey: string) => string;
export const builtinName: NameOf = (k) => BUILTIN_STATUSES[k]?.name ?? k;

export const TRIGGER_LABEL: Record<Trigger, string> = {
  always: "",
  onUse: "[On Use]",
  clashStart: "[Clash Start]",
  clashWin: "[Clash Win]",
  clashLose: "[Clash Lose]",
  beforeAttack: "[Before Attack]",
  unopposedAttack: "[On Unopposed Attack]",
  attackEnd: "[Attack End]",
  onKill: "[On Kill]",
  onEvade: "[On Evade]",
  coinStart: "[Coin Start]",
  onHit: "[On Hit]",
  headsHit: "[Heads Hit]",
  tailsHit: "[Tails Hit]",
  hitAfterClashWin: "[Hit after Clash Win]",
  hitAfterClashLose: "[Hit after Clash Lose]",
  hitWithoutCracking: "[On Hit without Cracking]",
  onCrit: "[On Crit]",
  coinKill: "[On Kill]",
  coinAttackEnd: "[Current Coin Attack End]",
  encounterStart: "[Encounter Start]",
  turnStart: "[Turn Start]",
  combatStart: "[Combat Start]",
  turnEnd: "[Turn End]",
  whenHit: "When hit:",
  onHitDealt: "When hitting with a skill:",
  onSkillUse: "When using a skill:",
  onClashWinAny: "On Clash Win:",
  onClashLoseAny: "On Clash Lose:",
  onKillAny: "After defeating an enemy:",
  onAllyDeath: "When an ally dies:",
  onEnemyStaggered: "When an enemy is Staggered:",
  whenStaggered: "When this unit is Staggered:",
  onInflictStatus: "When inflicting a status:",
};

/** Plain-language help for every trigger (shown in the rule builder). */
export const TRIGGER_HELP: Record<Trigger, string> = {
  always: "Always on while the condition is true. Use it for constant bonuses like \"+10% damage against Staggered targets\".",
  onUse: "When the skill is used: as it starts a Clash, or right before it attacks.",
  clashStart: "At the start of a Clash (only if the skill Clashes).",
  clashWin: "When the skill destroys all of the opponent's coins.",
  clashLose: "When the skill loses all of its coins (or all Unbreakable coins crack).",
  beforeAttack: "Once, right before the skill starts hitting.",
  unopposedAttack: "Like Before Attack, but only if the skill did not Clash.",
  attackEnd: "Once, after the skill has used all of its coins.",
  onKill: "When this skill defeats a target.",
  onEvade: "Evade skills only: each time a coin is evaded.",
  coinStart: "Right before this coin is tossed.",
  onHit: "Each time this coin hits a target.",
  headsHit: "When this coin lands Heads and hits.",
  tailsHit: "When this coin lands Tails and hits.",
  hitAfterClashWin: "When this coin hits after the skill won its Clash.",
  hitAfterClashLose: "Unbreakable coins only: when this coin hits after losing the Clash.",
  hitWithoutCracking: "Unbreakable coins only: when this coin hits without having cracked.",
  onCrit: "When this coin lands a Critical Hit.",
  coinKill: "When this coin defeats a target.",
  coinAttackEnd: "After this coin has been used.",
  encounterStart: "Once, when the fight begins.",
  turnStart: "At the start of every turn.",
  combatStart: "When the combat phase starts (after skills are chosen). Resonance requirements are checked here.",
  turnEnd: "At the end of every turn.",
  whenHit: "Each time this unit is hit by a coin.",
  onHitDealt: "Each time this unit hits something with a coin.",
  onSkillUse: "Each time this unit uses a skill.",
  onClashWinAny: "Whenever this unit wins a Clash.",
  onClashLoseAny: "Whenever this unit loses a Clash.",
  onKillAny: "Whenever this unit defeats an enemy.",
  onAllyDeath: "Whenever an ally of this unit dies.",
  onEnemyStaggered: "Whenever an enemy of this unit becomes Staggered.",
  whenStaggered: "When this unit becomes Staggered.",
  onInflictStatus: "Whenever this unit inflicts or gains a status (use \"Inflicted status is\" to pick which).",
};

export const WHO_LABEL: Record<Who, string> = {
  self: "self",
  target: "target",
  mainTarget: "main target",
  allAllies: "all allies",
  otherAllies: "other allies",
  allEnemies: "all enemies",
  randomEnemy: "random enemy",
  randomAlly: "random ally",
  lowestHpAlly: "lowest-HP ally",
  lowestSpAlly: "lowest-SP ally",
  fastestAlly: "fastest ally",
  slowestAlly: "slowest ally",
  lowestHpEnemy: "lowest-HP enemy",
  fastestEnemy: "fastest enemy",
  alliesAfterSelf: "allies placed after this unit",
};

export const QUANTITY_LABEL: Record<Quantity["kind"], string> = {
  statusPotency: "status Potency",
  statusCount: "status Count",
  statusSum: "status Potency + Count",
  statusOnAllEnemies: "status on all enemies",
  hp: "HP",
  hpPct: "HP %",
  missingHp: "missing HP",
  missingHpPct: "missing HP %",
  maxHp: "max HP",
  sp: "SP",
  speed: "Speed",
  speedDiff: "Speed difference (self − target)",
  level: "Level",
  staggerLevel: "Stagger level",
  shield: "Shield",
  negativeEffects: "negative effects",
  positiveEffects: "positive effects",
  clashCount: "Clash count",
  headsCount: "Heads so far (this skill)",
  tailsCount: "Tails so far (this skill)",
  coinIndex: "coin number",
  coinCount: "coins on the skill",
  turn: "turn number",
  alliesAlive: "allies alive",
  enemiesAlive: "enemies alive",
  alliesDead: "allies defeated",
  resonance: "Sin Resonance",
  owned: "owned E.G.O resources",
  damageDealt: "damage of this coin",
  skillDamage: "damage of this skill so far",
};

export const QUANTITY_NEEDS: Partial<Record<Quantity["kind"], ("who" | "status" | "field" | "sin")[]>> = {
  statusPotency: ["who", "status"],
  statusCount: ["who", "status"],
  statusSum: ["who", "status"],
  statusOnAllEnemies: ["status", "field"],
  hp: ["who"], hpPct: ["who"], missingHp: ["who"], missingHpPct: ["who"], maxHp: ["who"], sp: ["who"], speed: ["who"],
  level: ["who"], staggerLevel: ["who"], shield: ["who"], negativeEffects: ["who"], positiveEffects: ["who"],
  resonance: ["sin"], owned: ["sin"],
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const signed = (n: number) => (n >= 0 ? `+${num(n)}` : `−${num(Math.abs(n))}`);

export function describeQuantity(q: Quantity, nameOf: NameOf = builtinName): string {
  const who = WHO_LABEL[q.who];
  const st = nameOf(q.status);
  switch (q.kind) {
    case "statusPotency":
      return `${st} Potency on ${who}`;
    case "statusCount":
      return `${st} Count on ${who}`;
    case "statusSum":
      return `${st} (Potency + Count) on ${who}`;
    case "statusOnAllEnemies":
      return `${st} ${q.field === "count" ? "Count" : "Potency"} on all enemies`;
    case "resonance":
      return `${SIN_LABEL[q.sin]} Resonance`;
    case "owned":
      return `owned ${SIN_LABEL[q.sin]} E.G.O resources`;
    default: {
      const needs = QUANTITY_NEEDS[q.kind];
      return needs?.includes("who") ? `${QUANTITY_LABEL[q.kind]} of ${who}` : QUANTITY_LABEL[q.kind];
    }
  }
}

/** "2", or "+1 for every 3 Burn Potency on target (max 3)" */
export function describeValue(v: Value, nameOf: NameOf = builtinName, unit = "", withSign = false): string {
  const fmt = (n: number) => (withSign ? signed(n) : num(n)) + unit;
  if (!v.per) {
    let s = fmt(v.base);
    if (v.max !== null && v.max !== undefined && v.max < v.base) s = fmt(v.max);
    return s;
  }
  const every = v.per.every === 1 ? "" : ` ${num(v.per.every)}`;
  let s = `${v.base ? fmt(v.base) + ", " : ""}${fmt(v.per.amount)} for every${every} ${describeQuantity(v.per.q, nameOf)}`;
  const caps: string[] = [];
  if (v.max !== null && v.max !== undefined) caps.push(`max ${num(v.max)}${unit}`);
  if (v.min !== null && v.min !== undefined) caps.push(`min ${num(v.min)}${unit}`);
  if (caps.length) s += ` (${caps.join(", ")})`;
  return s;
}

const OP_WORD: Record<string, string> = { ">=": "is at least", "<=": "is at most", ">": "is above", "<": "is below", "==": "is", "!=": "is not" };

export function describeCondition(c: Condition, nameOf: NameOf = builtinName): string {
  const who = WHO_LABEL[c.who];
  const st = nameOf(c.status);
  const neg = c.not;
  switch (c.kind) {
    case "compare": {
      if (!c.q) return "(pick a value)";
      if ((c.q.kind === "statusPotency" || c.q.kind === "statusCount") && c.op === ">=" && !neg)
        return `${WHO_LABEL[c.q.who]} has ${num(c.value)}+ ${nameOf(c.q.status)}${c.q.kind === "statusCount" ? " Count" : ""}`;
      const s = `${describeQuantity(c.q, nameOf)} ${OP_WORD[c.op]} ${num(c.value)}${c.q.kind.endsWith("Pct") ? "%" : ""}`;
      return neg ? `not (${s})` : s;
    }
    case "hasStatus":
      return `${who} ${neg ? "doesn't have" : "has"} ${st}`;
    case "isStaggered":
      return `${who} is ${neg ? "not " : ""}Staggered`;
    case "isHeads":
      return neg ? "this coin is not Heads" : "this coin is Heads";
    case "isTails":
      return neg ? "this coin is not Tails" : "this coin is Tails";
    case "isCrit":
      return neg ? "this is not a Critical Hit" : "this is a Critical Hit";
    case "skillSin":
      return `the skill is ${neg ? "not " : ""}${SIN_LABEL[c.sin]}`;
    case "skillDmgType":
      return `the skill is ${neg ? "not " : ""}${DMG_LABEL[c.dmgType]}`;
    case "skillSlot":
      return `the skill is ${neg ? "not " : ""}${c.slot === "DEF" ? "a Defense skill" : c.slot === "EGO" ? "an E.G.O skill" : `Skill ${c.slot.slice(1)}`}`;
    case "skillInflicts":
      return `the skill ${neg ? "doesn't inflict" : "inflicts"} ${st}`;
    case "clashWon":
      return neg ? "this skill did not win its Clash" : "this skill won its Clash";
    case "clashLost":
      return neg ? "this skill did not lose its Clash" : "this skill lost its Clash";
    case "unopposed":
      return neg ? "this skill Clashed" : "this skill did not Clash";
    case "chance":
      return `${num(c.value)}% chance`;
    case "absoluteResonance":
      return `${SIN_LABEL[c.sin]} Absolute Resonance is ${neg ? "not " : ""}active`;
    case "targetIsEnemy":
      return neg ? "the target is an ally" : "the target is an enemy";
    case "sinner":
      return `this unit is ${neg ? "not " : ""}${c.text || "(pick a Sinner)"}`;
    case "trait":
      return `this unit ${neg ? "lacks" : "has"} the "${c.text}" trait`;
    case "isPanicked":
      return `${who} is ${neg ? "not " : ""}at Low Morale or Panicking`;
    case "statusIs":
      return `the status is ${neg ? "not " : ""}${st}`;
  }
  return "";
}

const MOD_TEXT: Record<Action["stat"], (v: string, a: Action, nameOf: NameOf) => string> = {
  basePower: (v) => `Base Power ${v}`,
  coinPower: (v, a) => `${a.coin ? `Coin ${a.coin} ` : ""}Coin Power ${v}`,
  finalPower: (v) => `Final Power ${v}`,
  clashPower: (v) => `Clash Power ${v}`,
  offenseLevel: (v) => `Offense Level ${v}`,
  defenseLevel: (v) => `Defense Level ${v}`,
  dmgDealt: (v) => `Deal ${v}% damage`,
  dmgTaken: (v) => `Take ${v}% damage`,
  critChance: (v) => `${v}% Critical Hit chance`,
  critDmg: (v) => `${v}% Critical Hit damage`,
  atkWeight: (v) => `Atk Weight ${v}`,
  headsChance: (v) => `${v}% chance to flip Heads`,
  speed: (v) => `Speed ${v}`,
  statusDmgTaken: (v, a, nameOf) => `Take ${v}% damage from ${nameOf(a.status)}`,
  resist: (v, a) => `${a.sin ? SIN_LABEL[a.sin] : a.dmgType ? DMG_LABEL[a.dmgType] : "(pick a type)"} Resistance ${v}`,
  cannotBeStaggered: () => "Cannot be Staggered",
};

function whoSuffix(a: Action, defaultWho: Who[]): string {
  if (defaultWho.includes(a.who)) return "";
  const n = a.count > 1 && ["randomEnemy", "randomAlly", "lowestHpAlly", "lowestSpAlly", "fastestAlly", "slowestAlly", "lowestHpEnemy", "fastestEnemy", "alliesAfterSelf"].includes(a.who) ? `${a.count} ` : "";
  return ` ${a.kind === "inflict" ? "on" : "to"} ${n}${WHO_LABEL[a.who]}${n && !WHO_LABEL[a.who].endsWith("s") ? "s" : ""}`;
}

export function describeAction(a: Action, nameOf: NameOf = builtinName): string {
  const amt = (withSign = false, unit = "") => describeValue(a.amount, nameOf, unit, withSign);
  const timing = a.timing === "nextTurn" ? " next turn" : "";
  switch (a.kind) {
    case "inflict": {
      const name = nameOf(a.status);
      const def = BUILTIN_STATUSES[a.status];
      const isPc = def ? def.mode === "pc" : a.potency.base !== 0 || !!a.potency.per;
      const verb = a.who === "self" ? "Gain" : a.who === "target" || a.who === "mainTarget" ? "Inflict" : "Apply";
      let what: string;
      if (isPc) {
        const p = a.potency.base !== 0 || a.potency.per ? `${describeValue(a.potency, nameOf)} ${name}` : "";
        const c = a.amount.base !== 0 || a.amount.per ? `+${describeValue(a.amount, nameOf)} ${name} Count` : "";
        what = [p, c].filter(Boolean).join(" and ") || `${name}`;
      } else what = `${amt()} ${name}`;
      return `${verb} ${what}${timing}${whoSuffix(a, ["self", "target"])}`;
    }
    case "reduceStatus":
      return `${a.who === "self" ? "Consume" : "Remove"} ${amt()} ${nameOf(a.status)} ${a.field === "count" ? "Count" : "Potency"}${whoSuffix(a, ["self", "target"])}${a.who === "target" ? " from target" : ""}`;
    case "removeStatus":
      return `Remove all ${nameOf(a.status)}${whoSuffix(a, ["self", "target"])}${a.who === "target" ? " from target" : ""}`;
    case "healHp":
      return `Heal ${amt()}${a.hpMode === "pctMax" ? "% of max HP" : a.hpMode === "pctMissing" ? "% of missing HP" : " HP"}${whoSuffix(a, ["self"])}`;
    case "loseHp":
      return `Lose ${amt()}${a.hpMode === "pctMax" ? "% of max HP" : a.hpMode === "pctMissing" ? "% of missing HP" : " HP"}${whoSuffix(a, ["self"])}`;
    case "fixedDamage":
      return `Deal ${amt()} ${a.sin ? SIN_LABEL[a.sin] + " " : a.dmgType ? DMG_LABEL[a.dmgType] + " " : "fixed "}damage${whoSuffix(a, ["target"])}`;
    case "coinDamagePct":
      return `Deal ${amt(false, "%")} of this coin's damage as ${a.sin ? SIN_LABEL[a.sin] + " " : a.dmgType ? DMG_LABEL[a.dmgType] + " " : "fixed "}damage${whoSuffix(a, ["target"])}`;
    case "healSp":
      return `Heal ${amt()} SP${whoSuffix(a, ["self"])}`;
    case "loseSp":
      return a.who === "self" ? `Lose ${amt()} SP` : `Deal ${amt()} SP damage${whoSuffix(a, ["target"])}`;
    case "shield":
      return `Gain ${amt()}${a.hpMode === "pctMax" ? "% of max HP as" : ""} Shield${whoSuffix(a, ["self"])}`;
    case "tremorBurst":
      return `Trigger Tremor Burst${a.amount.base > 1 || a.amount.per ? ` ${amt()} times` : ""}${whoSuffix(a, ["target"])}`;
    case "convertTremor":
      return `${a.entangle ? "Entangle" : "Convert"} Tremor ${a.entangle ? "with" : "into"} ${TREMOR_TYPE_INFO[a.tremorType]?.name ?? a.tremorType}${whoSuffix(a, ["target"])}`;
    case "sinkingDeluge":
      return `Trigger Sinking Deluge${whoSuffix(a, ["target"])}`;
    case "raiseStaggerThreshold":
      return `Raise the Stagger Threshold by ${amt()}${whoSuffix(a, ["target"])}`;
    case "gainResource":
      return `Gain ${amt()} ${a.sin ? SIN_LABEL[a.sin] : "(skill's affinity)"} E.G.O resource`;
    case "reuseCoin":
      return `Reuse this coin${a.amount.base > 1 ? ` ${amt()} times` : " once"}`;
    case "forceStagger":
      return `Stagger${whoSuffix(a, ["target"]) || " the target"}`;
    case "mod": {
      const v = describeValue(a.amount, nameOf, "", true);
      let s = MOD_TEXT[a.stat](v, a, nameOf);
      if (a.stat !== "resist" && (a.sin || a.dmgType)) s += ` ${a.stat === "dmgTaken" ? "from" : "with"} ${a.sin ? SIN_LABEL[a.sin] : DMG_LABEL[a.dmgType!]} skills`;
      if (a.scope === "turn") s += " this turn";
      if (a.scope === "nextTurn") s += " next turn";
      return s + whoSuffix(a, ["self"]);
    }
    case "note":
      return a.text || "(note)";
  }
  return "";
}

export function describeEffect(e: Effect, nameOf: NameOf = builtinName): string {
  if (e.text.trim()) return e.text.trim();
  const tag = TRIGGER_LABEL[e.trigger];
  const conds = e.conditions.map((c) => describeCondition(c, nameOf));
  const acts = e.actions.map((a) => describeAction(a, nameOf)).filter(Boolean);
  let s = conds.length ? `If ${conds.join(" and ")}: ` : "";
  s += acts.length ? acts.join("; ") : "(no action yet)";
  const limits: string[] = [];
  if (e.perTurn) limits.push(e.perTurn === 1 ? "once per turn" : `${e.perTurn} times per turn`);
  if (e.perEncounter) limits.push(e.perEncounter === 1 ? "once per encounter" : `${e.perEncounter} times per encounter`);
  if (limits.length) s += ` (${limits.join(", ")})`;
  return tag ? `${tag} ${s}` : s;
}

/** True when an effect contains something the simulator does not run (only notes). */
export function isNoteOnly(e: Effect): boolean {
  return e.actions.length > 0 && e.actions.every((a) => a.kind === "note");
}
