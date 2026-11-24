// Rule builder for effects: When <trigger> · Only if <conditions> · Do <actions>.
import { useEffect, useId, useRef, useState } from "react";
import type { Draft } from "immer";
import {
  ACTIONS, CONDITIONS, MAX_QUANTITIES, MOD_STATS, OPS, QUANTITIES, SKILL_SLOTS, WHO, newId, readQuantities, val, writeQuantities, zAction, zCondition, zEffect,
  type Action, type Condition, type Effect, type Quantity, type Trigger, type Value,
} from "../../data/schema";
import { DMG_LABEL, DMG_TYPES, SIN_LABEL, SINNERS, SINS } from "../../engine/constants";
import { BUILTIN_STATUSES, TREMOR_TYPES, TREMOR_TYPE_INFO } from "../../engine/statuses";
import {
  QUANTITY_LABEL, QUANTITY_NEEDS, TRIGGER_HELP, TRIGGER_LABEL, WHO_LABEL, describeEffect, isNoteOnly,
} from "../../engine/describe";
import { Button, Check, NumberInput, Select, TextInput, type Opt } from "../../ui/controls";
import { StatusSelect, useStatusName } from "../../ui/game";
import { useWorkspace } from "../../store/workspace";
import { toast } from "../../store/toast";
import { Icon } from "../../ui/icons";
import {
  LIMIT_TEXT, OLD_DUPLICATE_NOTE, addedMessage, duplicateMessage, duplicateOf, groupName, hasDuplicates, nextQuantity, removedMessage,
} from "./quantityList";

export type Edit<T> = (fn: (d: Draft<T>) => void, key?: string) => void;
export type RuleScope = "coin" | "skill" | "unit";

const COIN_TRIGGERS: Trigger[] = ["onHit", "headsHit", "tailsHit", "hitAfterClashWin", "hitAfterClashLose", "hitWithoutCracking", "onCrit", "coinKill", "coinStart", "coinAttackEnd"];
const SKILL_TRIGGERS: Trigger[] = ["onUse", "clashStart", "clashWin", "clashLose", "beforeAttack", "unopposedAttack", "attackEnd", "onKill", "onEvade", "combatStart", "turnEnd"];
const UNIT_TRIGGERS: Trigger[] = ["encounterStart", "turnStart", "combatStart", "turnEnd", "whenHit", "onHitDealt", "onSkillUse", "onClashWinAny", "onClashLoseAny", "onKillAny", "onAllyDeath", "onEnemyStaggered", "whenStaggered", "onInflictStatus"];

const triggerLabel = (t: Trigger) => (t === "always" ? "Always (constant bonus)" : TRIGGER_LABEL[t].replace(/[[\]:]/g, ""));

function triggerOptions(scope: RuleScope): Opt<Trigger>[] {
  const opt = (t: Trigger, group: string): Opt<Trigger> => ({ value: t, label: triggerLabel(t), group });
  if (scope === "coin") return [opt("always", "Constant"), ...COIN_TRIGGERS.map((t) => opt(t, "This coin"))];
  if (scope === "skill") return [opt("always", "Constant"), ...SKILL_TRIGGERS.map((t) => opt(t, "This skill")), ...COIN_TRIGGERS.map((t) => opt(t, "Every coin of this skill"))];
  return [opt("always", "Constant"), ...UNIT_TRIGGERS.map((t) => opt(t, "This unit"))];
}

export const ACTION_LABEL: Record<Action["kind"], string> = {
  inflict: "Inflict / gain a status",
  reduceStatus: "Reduce / consume a status",
  removeStatus: "Remove a status",
  mod: "Change a number (power, damage %, level…)",
  healHp: "Heal HP",
  loseHp: "Lose HP (self damage)",
  fixedDamage: "Deal fixed damage",
  coinDamagePct: "Extra hit: % of this coin's damage",
  healSp: "Heal SP",
  loseSp: "SP damage / lose SP",
  shield: "Gain Shield",
  triggerStatus: "Trigger a status now (Burn, Bleed, Rupture, Sinking, Tremor Burst…)",
  tremorBurst: "Trigger Tremor Burst",
  convertTremor: "Change Tremor type",
  sinkingDeluge: "Trigger Sinking Deluge",
  raiseStaggerThreshold: "Raise Stagger Threshold",
  gainResource: "Gain E.G.O resource",
  reuseCoin: "Reuse this coin",
  forceStagger: "Stagger the unit",
  note: "Note only (not simulated)",
};

export const STAT_LABEL: Record<Action["stat"], string> = {
  basePower: "Base Power",
  coinPower: "Coin Power",
  finalPower: "Final Power (every coin)",
  clashPower: "Clash Power (Clash only)",
  offenseLevel: "Offense Level",
  defenseLevel: "Defense Level",
  dmgDealt: "Damage dealt (%)",
  dmgTaken: "Damage taken (%)",
  critChance: "Critical Hit chance (%)",
  critDmg: "Critical Hit damage (%)",
  atkWeight: "Atk Weight",
  headsChance: "Heads chance (%)",
  speed: "Speed",
  statusDmgTaken: "Damage taken from a status (%)",
  resist: "Resistance (+0.1 = more damage taken)",
  cannotBeStaggered: "Cannot be Staggered (1 = on)",
  cannotStagger: "This Skill's damage cannot Stagger (1 = on)",
};

const CONDITION_LABEL: Record<Condition["kind"], string> = {
  compare: "A number compares to a value",
  hasStatus: "Unit has a status",
  isStaggered: "Unit is Staggered",
  isHeads: "This coin landed Heads",
  isTails: "This coin landed Tails",
  isCrit: "This hit is a Critical Hit",
  isReuse: "This Coin is a Reuse (a repeated hit)",
  skillSin: "Skill has a sin affinity",
  skillDmgType: "Skill has a damage type",
  skillSlot: "Skill is Skill 1 / 2 / 3 / Defense / E.G.O",
  skillInflicts: "Skill inflicts a status",
  clashWon: "This skill won its Clash",
  clashLost: "This skill lost its Clash",
  unopposed: "This skill did not Clash",
  chance: "Random chance (%)",
  absoluteResonance: "Absolute Resonance is active",
  targetIsEnemy: "The other unit is an enemy",
  sinner: "This unit is a specific Sinner",
  trait: "This unit has a trait",
  isPanicked: "Unit is at Low Morale or Panicking",
  statusIs: "The inflicted status is…",
};

const WHO_OPTIONS: Opt<(typeof WHO)[number]>[] = WHO.map((w) => ({ value: w, label: WHO_LABEL[w] }));
const SIN_OPT_NULL: Opt<string>[] = [{ value: "", label: "Any / none" }, ...SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))];
const DMG_OPT_NULL: Opt<string>[] = [{ value: "", label: "Any / none" }, ...DMG_TYPES.map((d) => ({ value: d, label: DMG_LABEL[d] }))];
const DEFAULT_Q: Quantity = { kind: "statusPotency", who: "target", status: "BURN", field: "potency", sin: "WRATH" };
const MULTI_WHO = ["randomEnemy", "randomAlly", "lowestHpAlly", "lowestSpAlly", "fastestAlly", "slowestAlly", "lowestHpEnemy", "fastestEnemy", "alliesAfterSelf"];

// ---------------------------------------------------------------------------------
function QuantityEditor({ q, edit, label = "Value", prefix, describedBy }: { q: Quantity; edit: Edit<Quantity>; label?: string; prefix?: string; describedBy?: string }) {
  const needs = QUANTITY_NEEDS[q.kind] ?? [];
  // Inside a numbered group every control's name starts with the group, e.g. "Quantity 2: status".
  const name = (text: string) => (prefix ? `${prefix}: ${text.toLowerCase()}` : text);
  return (
    <>
      <Select label={prefix ? name("what") : label} describedBy={describedBy} value={q.kind} onChange={(v) => edit((d) => void (d.kind = v))} options={QUANTITIES.map((k) => ({ value: k, label: QUANTITY_LABEL[k] }))} />
      {needs.includes("status") && <StatusSelect label={name("Status")} describedBy={describedBy} value={q.status} onChange={(v) => edit((d) => void (d.status = v))} />}
      {needs.includes("field") && <Select label={name("Field")} describedBy={describedBy} value={q.field} onChange={(v) => edit((d) => void (d.field = v))} options={[{ value: "potency", label: "Potency" }, { value: "count", label: "Count" }]} />}
      {needs.includes("who") && <Select label={name("Of whom")} describedBy={describedBy} value={q.who} onChange={(v) => edit((d) => void (d.who = v))} options={WHO_OPTIONS} />}
      {needs.includes("sin") && <Select label={name("Sin")} describedBy={describedBy} value={q.sin} onChange={(v) => edit((d) => void (d.sin = v))} options={SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))} />}
    </>
  );
}

const DEFAULT_PER = (): NonNullable<Value["per"]> => ({ q: { ...DEFAULT_Q }, q2: null, every: 1, amount: 1 });

/** A number, optionally scaling with a sum of up to 5 quantities: "+2 for every 4 (Bleed + Burn on target) (max 4)". */
export function ValueEditor({ label, v, edit, suffix, allowNegative = true }: { label: string; v: Value; edit: Edit<Value>; suffix?: string; allowNegative?: boolean }) {
  const scaling = !!v.per;
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  // What scaling looked like before it was turned off, so turning it back on in the same rule brings it back.
  const kept = useRef<Value["per"]>(null);
  const [refusal, setRefusal] = useState<{ index: number; text: string } | null>(null);
  const focusNext = useRef<{ group: number } | null>(null);
  const list = v.per ? readQuantities(v.per) : [];
  const atLimit = list.length >= MAX_QUANTITIES;
  const limitId = `${uid}-limit`;
  const refusalId = `${uid}-refusal`;

  // Move focus after an add or remove, once the new groups are on the page. Never leaves it on the page body.
  useEffect(() => {
    const target = focusNext.current;
    if (!target || !root.current) return;
    focusNext.current = null;
    const el = root.current.querySelector<HTMLElement>(`[data-qgroup="${target.group}"] select`);
    el?.focus();
  });

  const editQuantity = (i: number, fn: (d: Draft<Quantity>) => void, key?: string) => {
    if (!v.per) return;
    // Try the change on a copy first, so a repeat of another quantity can be refused before anything is saved.
    const trial = list.map((x) => ({ ...x }));
    fn(trial[i] as Draft<Quantity>);
    const other = duplicateOf(trial, i);
    if (other >= 0) {
      const text = duplicateMessage(i + 1, other + 1);
      setRefusal({ index: i, text });
      toast(text, "info");
      return;
    }
    setRefusal(null);
    edit((d) => fn(readQuantities(d.per!)[i] as Draft<Quantity>), key);
  };

  const add = () => {
    if (!v.per || atLimit) return;
    const n = list.length + 1;
    setRefusal(null);
    edit((d) => {
      const l = readQuantities(d.per!);
      if (l.length >= MAX_QUANTITIES) return;
      writeQuantities(d.per!, [...l, nextQuantity(l)]);
    });
    focusNext.current = { group: n - 1 };
    toast(addedMessage(n), "info");
  };

  const remove = (i: number) => {
    if (!v.per) return;
    setRefusal(null);
    edit((d) => {
      const l = readQuantities(d.per!);
      if (l.length < 2) return;
      l.splice(i, 1);
      writeQuantities(d.per!, l);
    });
    focusNext.current = { group: i - 1 }; // only quantities 2 to 5 have Remove, so i is at least 1
    toast(removedMessage(i + 1, list.length - 1), "info");
  };

  return (
    <div className="fields full" style={{ gridColumn: "1 / -1" }} ref={root}>
      <NumberInput label={scaling ? `${label}: flat part` : label} value={v.base} onChange={(n) => edit((d) => void (d.base = n), "v-base")} min={allowNegative ? -999 : 0} max={9999} decimals={2} suffix={suffix} />
      <Check
        label="Scales with something"
        checked={scaling}
        onChange={(on) => {
          if (!on) kept.current = v.per;
          edit((d) => {
            d.per = on ? kept.current ?? DEFAULT_PER() : null;
          });
          setRefusal(null);
        }}
        hint={scaling ? undefined : 'e.g. "+1 for every 3 Burn on target"'}
      />
      {v.per && (
        <>
          <NumberInput label="Add" value={v.per.amount} onChange={(n) => edit((d) => void (d.per!.amount = n), "v-amt")} min={-999} max={999} decimals={2} />
          <NumberInput label="For every" value={v.per.every} onChange={(n) => edit((d) => void (d.per!.every = n), "v-every")} min={0.01} max={999} decimals={2} />
          {list.map((q, i) => {
            const refused = refusal?.index === i;
            return (
              <fieldset key={i} className="quantity-group" data-qgroup={i} aria-describedby={refused ? refusalId : undefined}>
                <legend>{groupName(i + 1, list.length)}</legend>
                <div className="fields">
                  <QuantityEditor q={q} prefix={`Quantity ${i + 1}`} describedBy={refused ? refusalId : undefined} edit={(fn, k) => editQuantity(i, fn, k)} />
                </div>
                {refused && (
                  <p id={refusalId} className="quantity-note warn">
                    <Icon name="warn" size={15} /> <span>{refusal.text}</span>
                  </p>
                )}
                {i > 0 && <Button onClick={() => remove(i)}>{`Remove quantity ${i + 1}`}</Button>}
              </fieldset>
            );
          })}
          {!refusal && hasDuplicates(list) && (
            <p className="quantity-note">
              <Icon name="info" size={15} /> <span>{OLD_DUPLICATE_NOTE}</span>
            </p>
          )}
          <div className="quantity-add">
            <Button onClick={add} ariaDisabled={atLimit} describedBy={atLimit ? limitId : undefined} icon="plus">
              Add another quantity
            </Button>
            {atLimit && (
              <span id={limitId} className="quantity-note">
                <Icon name="info" size={15} /> <span>{LIMIT_TEXT}</span>
              </span>
            )}
          </div>
          <NumberInput label="Max (empty = none)" value={v.max ?? 0} onChange={(n) => edit((d) => void (d.max = n === 0 ? null : n), "v-max")} min={-999} max={9999} decimals={2} hint="0 means no cap" />
        </>
      )}
    </div>
  );
}

function ConditionEditor({ c, edit, onRemove }: { c: Condition; edit: Edit<Condition>; onRemove: () => void }) {
  return (
    <div className="rule-item">
      <div className="fields">
        <Select label="Condition" className="span-2" value={c.kind} onChange={(v) => edit((d) => void (d.kind = v))} options={CONDITIONS.map((k) => ({ value: k, label: CONDITION_LABEL[k] }))} />
        {c.kind === "compare" && (
          <>
            <QuantityEditor
              q={c.q ?? DEFAULT_Q}
              edit={(fn, k) =>
                edit((d) => {
                  if (!d.q) d.q = { ...DEFAULT_Q };
                  fn(d.q);
                }, k)
              }
              label="Number"
            />
            <Select label="Is" value={c.op} onChange={(v) => edit((d) => void (d.op = v))} options={OPS.map((o) => ({ value: o, label: o.replace(">=", "≥ at least").replace("<=", "≤ at most").replace("==", "= exactly").replace("!=", "≠ not") }))} />
            <NumberInput label="Value" value={c.value} onChange={(n) => edit((d) => void (d.value = n), "c-val")} min={-9999} max={9999} decimals={2} />
          </>
        )}
        {(c.kind === "hasStatus" || c.kind === "isStaggered" || c.kind === "isPanicked") && <Select label="Unit" value={c.who} onChange={(v) => edit((d) => void (d.who = v))} options={WHO_OPTIONS} />}
        {(c.kind === "hasStatus" || c.kind === "skillInflicts" || c.kind === "statusIs") && <StatusSelect value={c.status} onChange={(v) => edit((d) => void (d.status = v))} />}
        {(c.kind === "skillSin" || c.kind === "absoluteResonance") && <Select label="Sin" value={c.sin} onChange={(v) => edit((d) => void (d.sin = v))} options={SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))} />}
        {c.kind === "skillDmgType" && <Select label="Damage type" value={c.dmgType} onChange={(v) => edit((d) => void (d.dmgType = v))} options={DMG_TYPES.map((s) => ({ value: s, label: DMG_LABEL[s] }))} />}
        {c.kind === "skillSlot" && <Select label="Skill" value={c.slot} onChange={(v) => edit((d) => void (d.slot = v))} options={SKILL_SLOTS.map((s) => ({ value: s, label: s === "DEF" ? "Defense" : s === "EGO" ? "E.G.O" : `Skill ${s.slice(1)}` }))} />}
        {c.kind === "chance" && <NumberInput label="Chance %" value={c.value} onChange={(n) => edit((d) => void (d.value = n), "c-val")} min={0} max={100} />}
        {c.kind === "sinner" && <Select label="Sinner" value={c.text || "Yi Sang"} onChange={(v) => edit((d) => void (d.text = v))} options={SINNERS.map((s) => ({ value: s, label: s }))} />}
        {c.kind === "trait" && <TextInput label="Trait" value={c.text} onChange={(v) => edit((d) => void (d.text = v), "c-text")} maxLength={40} />}
        <Check label="Reverse (NOT)" checked={c.not} onChange={(v) => edit((d) => void (d.not = v))} />
      </div>
      <Button icon="trash" small variant="ghost" label="Remove condition" onClick={onRemove} />
    </div>
  );
}

function ActionEditor({ a, edit, onRemove, trigger }: { a: Action; edit: Edit<Action>; onRemove: () => void; trigger: Trigger }) {
  const statusDefs = useWorkspace((s) => s.ws.statuses);
  const def = BUILTIN_STATUSES[a.status];
  const isPc = def ? def.mode === "pc" : statusDefs.find((x) => x.key === a.status)?.mode === "pc";
  const who = (label = "On whom") => (
    <>
      <Select label={label} value={a.who} onChange={(v) => edit((d) => void (d.who = v))} options={WHO_OPTIONS} />
      {MULTI_WHO.includes(a.who) && <NumberInput label="How many" value={a.count} onChange={(n) => edit((d) => void (d.count = n))} min={1} max={12} />}
    </>
  );
  const amount = (label: string, suffix?: string) => <ValueEditor label={label} v={a.amount} edit={(fn, k) => edit((d) => fn(d.amount), k)} suffix={suffix} />;
  return (
    <div className="rule-item">
      <div className="fields">
        <Select label="Action" className="span-2" value={a.kind} onChange={(v) => edit((d) => void (d.kind = v))} options={ACTIONS.map((k) => ({ value: k, label: ACTION_LABEL[k] }))} />
        {a.kind === "inflict" && (
          <>
            <StatusSelect value={a.status} onChange={(v) => edit((d) => void (d.status = v))} />
            {who()}
            <Select label="When" value={a.timing} onChange={(v) => edit((d) => void (d.timing = v))} options={[{ value: "now", label: "Now (this turn)" }, { value: "nextTurn", label: "Next turn" }]} />
            {isPc ? (
              <>
                <ValueEditor label="Potency" v={a.potency} edit={(fn, k) => edit((d) => fn(d.potency), k)} allowNegative={false} />
                {amount("Count")}
              </>
            ) : (
              amount("Amount")
            )}
          </>
        )}
        {(a.kind === "reduceStatus" || a.kind === "removeStatus") && (
          <>
            <StatusSelect value={a.status} onChange={(v) => edit((d) => void (d.status = v))} />
            {who("From whom")}
            {a.kind === "reduceStatus" && (
              <>
                <Select label="Which value" value={a.field} onChange={(v) => edit((d) => void (d.field = v))} options={[{ value: "count", label: "Count" }, { value: "potency", label: "Potency" }]} />
                {amount("Amount")}
              </>
            )}
          </>
        )}
        {(a.kind === "healHp" || a.kind === "loseHp" || a.kind === "shield") && (
          <>
            {who("Whom")}
            <Select
              label="Measured as"
              value={a.hpMode}
              onChange={(v) => edit((d) => void (d.hpMode = v))}
              options={a.kind === "shield" ? [{ value: "flat", label: "Flat amount" }, { value: "pctMax", label: "% of max HP" }] : [{ value: "flat", label: "Flat HP" }, { value: "pctMax", label: "% of max HP" }, { value: "pctMissing", label: "% of missing HP" }]}
            />
            {amount("Amount")}
          </>
        )}
        {(a.kind === "fixedDamage" || a.kind === "coinDamagePct") && (
          <>
            {who("Target")}
            <Select label="Sin (uses Sin resistance)" value={a.sin ?? ""} onChange={(v) => edit((d) => void (d.sin = (v || null) as never))} options={SIN_OPT_NULL} />
            <Select label="Damage type" value={a.dmgType ?? ""} onChange={(v) => edit((d) => void (d.dmgType = (v || null) as never))} options={DMG_OPT_NULL} />
            {amount(a.kind === "coinDamagePct" ? "Percent of the coin's damage" : "Damage", a.kind === "coinDamagePct" ? "%" : undefined)}
          </>
        )}
        {(a.kind === "healSp" || a.kind === "loseSp") && (
          <>
            {who("Whom")}
            {amount("SP")}
          </>
        )}
        {(a.kind === "tremorBurst" || a.kind === "sinkingDeluge" || a.kind === "forceStagger") && who("Target")}
        {a.kind === "tremorBurst" && amount("Times")}
        {a.kind === "triggerStatus" && (
          <>
            <StatusSelect value={a.status} onChange={(v) => edit((d) => void (d.status = v))} />
            {who("Whose status")}
            {amount("Times (1–10)")}
          </>
        )}
        {a.kind === "convertTremor" && (
          <>
            {who("Target")}
            <Select label="Tremor type" value={a.tremorType} onChange={(v) => edit((d) => void (d.tremorType = v))} options={TREMOR_TYPES.map((t) => ({ value: t, label: TREMOR_TYPE_INFO[t].name }))} />
            <Check label="Entangle (add instead of replace)" checked={a.entangle} onChange={(v) => edit((d) => void (d.entangle = v))} />
          </>
        )}
        {a.kind === "raiseStaggerThreshold" && (
          <>
            {who("Target")}
            {amount("HP amount")}
          </>
        )}
        {a.kind === "gainResource" && (
          <>
            <Select label="Sin" value={a.sin ?? ""} onChange={(v) => edit((d) => void (d.sin = (v || null) as never))} options={[{ value: "", label: "The skill's affinity" }, ...SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))]} />
            {amount("Amount")}
          </>
        )}
        {a.kind === "reuseCoin" && amount("Times")}
        {a.kind === "mod" && (
          <>
            <Select label="Number to change" className="span-2" value={a.stat} onChange={(v) => edit((d) => void (d.stat = v))} options={MOD_STATS.map((s) => ({ value: s, label: STAT_LABEL[s] }))} />
            {a.stat === "statusDmgTaken" && <StatusSelect value={a.status} onChange={(v) => edit((d) => void (d.status = v))} />}
            {a.stat === "coinPower" && <NumberInput label="Only coin # (0 = all)" value={a.coin} onChange={(n) => edit((d) => void (d.coin = n))} min={0} max={10} />}
            {trigger !== "always" && (
              <Select
                label="Lasts"
                value={a.scope}
                onChange={(v) => edit((d) => void (d.scope = v))}
                options={[{ value: "skill", label: "This skill use" }, { value: "coin", label: "This coin only" }, { value: "turn", label: "Rest of this turn" }, { value: "nextTurn", label: "Next turn" }]}
              />
            )}
            {trigger !== "always" && who("For whom")}
            <Select label="Only for sin" value={a.sin ?? ""} onChange={(v) => edit((d) => void (d.sin = (v || null) as never))} options={SIN_OPT_NULL} />
            <Select label="Only for type" value={a.dmgType ?? ""} onChange={(v) => edit((d) => void (d.dmgType = (v || null) as never))} options={DMG_OPT_NULL} />
            {amount(a.stat === "resist" ? "Change (e.g. 0.5)" : "Change", ["dmgDealt", "dmgTaken", "critChance", "critDmg", "headsChance", "statusDmgTaken"].includes(a.stat) ? "%" : undefined)}
          </>
        )}
        {a.kind === "note" && <TextInput label="Text" className="full" value={a.text} onChange={(v) => edit((d) => void (d.text = v), "a-text")} maxLength={400} hint="Shown in the description; the simulator ignores notes." />}
      </div>
      <Button icon="trash" small variant="ghost" label="Remove action" onClick={onRemove} />
    </div>
  );
}

function RuleEditor({ e, edit, scope, onRemove, onMove, onDuplicate, index, total }: { e: Effect; edit: Edit<Effect>; scope: RuleScope; onRemove: () => void; onMove: (d: -1 | 1) => void; onDuplicate: () => void; index: number; total: number }) {
  const nameOf = useStatusName();
  const [open, setOpen] = useState(e.actions.length === 0);
  const text = describeEffect(e, nameOf);
  const tag = text.match(/^\[[^\]]+\]|^[^:]+:/)?.[0] ?? "";
  return (
    <div className="rule">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="rule-text" style={{ flex: 1, minWidth: 200 }}>
          {tag && text.startsWith("[") ? <span className="tag">{tag} </span> : null}
          {tag && text.startsWith("[") ? text.slice(tag.length).trim() : text}
          {isNoteOnly(e) && <span className="badge warn" style={{ marginLeft: 8 }}>not simulated</span>}
        </div>
        <Button small onClick={() => setOpen(!open)} label={open ? "Done editing this rule" : "Edit this rule"}>
          {open ? "Done" : "Edit"}
        </Button>
        <Button icon="up" small variant="ghost" label="Move up" disabled={index === 0} onClick={() => onMove(-1)} />
        <Button icon="down" small variant="ghost" label="Move down" disabled={index === total - 1} onClick={() => onMove(1)} />
        <Button icon="copy" small variant="ghost" label="Duplicate rule" onClick={onDuplicate} />
        <Button icon="trash" small variant="ghost" label="Delete rule" onClick={onRemove} />
      </div>
      {open && (
        <>
          <div className="rule-block">
            <div className="label">When</div>
            <div className="fields">
              <Select label="Trigger" className="span-2" value={e.trigger} onChange={(v) => edit((d) => void (d.trigger = v))} options={triggerOptions(scope)} hint={TRIGGER_HELP[e.trigger]} />
            </div>
          </div>
          <div className="rule-block">
            <div className="label">Only if (optional)</div>
            {e.conditions.map((c, i) => (
              <ConditionEditor key={i} c={c} edit={(fn, k) => edit((d) => fn(d.conditions[i]), k ? `c${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.conditions.splice(i, 1))} />
            ))}
            <Button small icon="plus" onClick={() => edit((d) => void d.conditions.push(zCondition.parse({ kind: "hasStatus", who: "target", status: "BURN" })))}>
              Add condition
            </Button>
          </div>
          <div className="rule-block">
            <div className="label">Do</div>
            {e.actions.map((a, i) => (
              <ActionEditor key={i} a={a} trigger={e.trigger} edit={(fn, k) => edit((d) => fn(d.actions[i]), k ? `a${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.actions.splice(i, 1))} />
            ))}
            <Button small icon="plus" onClick={() => edit((d) => void d.actions.push(zAction.parse({ kind: "inflict", status: "BURN", potency: val(1), amount: val(0) })))}>
              Add action
            </Button>
          </div>
          <div className="rule-block">
            <div className="label">Limits &amp; wording</div>
            <div className="fields">
              <NumberInput label="Max per turn (0 = no limit)" value={e.perTurn} onChange={(n) => edit((d) => void (d.perTurn = n))} min={0} max={99} />
              <NumberInput label="Times per Skill use (0 = no limit)" value={e.perUse} onChange={(n) => edit((d) => void (d.perUse = n))} min={0} max={99} />
              <NumberInput label="Max per encounter" value={e.perEncounter} onChange={(n) => edit((d) => void (d.perEncounter = n))} min={0} max={99} />
              <TextInput label="Custom wording (optional)" className="full" value={e.text} onChange={(v) => edit((d) => void (d.text = v), "e-text")} maxLength={400} hint="Replaces the generated text in previews. The rule above still decides what the simulator does." />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const PRESETS: Record<RuleScope, { label: string; make: () => Effect }[]> = {
  coin: [
    { label: "Inflict a status on hit", make: () => zEffect.parse({ id: newId(), trigger: "onHit", actions: [{ kind: "inflict", who: "target", status: "BURN", potency: val(2), amount: val(0) }] }) },
    { label: "Bonus on Heads", make: () => zEffect.parse({ id: newId(), trigger: "headsHit", actions: [{ kind: "inflict", who: "target", status: "BLEED", potency: val(1), amount: val(1) }] }) },
    { label: "This coin deals +% damage", make: () => zEffect.parse({ id: newId(), trigger: "always", actions: [{ kind: "mod", who: "self", stat: "dmgDealt", amount: val(10) }] }) },
  ],
  skill: [
    { label: "Power bonus on use", make: () => zEffect.parse({ id: newId(), trigger: "onUse", actions: [{ kind: "mod", who: "self", stat: "basePower", scope: "skill", amount: val(2) }] }) },
    { label: "+% damage with a condition", make: () => zEffect.parse({ id: newId(), trigger: "always", conditions: [{ kind: "isStaggered", who: "target" }], actions: [{ kind: "mod", who: "self", stat: "dmgDealt", amount: val(20) }] }) },
    { label: "Effect on Clash Win", make: () => zEffect.parse({ id: newId(), trigger: "clashWin", actions: [{ kind: "inflict", who: "self", status: "POWER_UP", amount: val(1), timing: "nextTurn" }] }) },
  ],
  unit: [
    { label: "Turn Start buff", make: () => zEffect.parse({ id: newId(), trigger: "turnStart", actions: [{ kind: "inflict", who: "self", status: "HASTE", amount: val(1) }] }) },
    { label: "Constant damage bonus", make: () => zEffect.parse({ id: newId(), trigger: "always", actions: [{ kind: "mod", who: "self", stat: "dmgDealt", amount: val(10) }] }) },
    { label: "When hit…", make: () => zEffect.parse({ id: newId(), trigger: "whenHit", actions: [{ kind: "inflict", who: "target", status: "BLEED", potency: val(1), amount: val(0) }] }) },
  ],
};

/** List of rules with quick-add presets. */
export function RulesEditor({ effects, edit, scope, emptyText }: { effects: Effect[]; edit: Edit<Effect[]>; scope: RuleScope; emptyText?: string }) {
  return (
    <div>
      {effects.length === 0 && <p className="muted small">{emptyText ?? "No effects yet."}</p>}
      {effects.map((e, i) => (
        <RuleEditor
          key={e.id}
          e={e}
          index={i}
          total={effects.length}
          scope={scope}
          edit={(fn, k) => edit((d) => fn(d[i]), k ? `${e.id}-${k}` : undefined)}
          onRemove={() => edit((d) => void d.splice(i, 1))}
          onDuplicate={() => edit((d) => void d.splice(i + 1, 0, { ...structuredClone(effects[i]), id: newId() }))}
          onMove={(dir) =>
            edit((d) => {
              const j = i + dir;
              if (j < 0 || j >= d.length) return;
              const [x] = d.splice(i, 1);
              d.splice(j, 0, x);
            })
          }
        />
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        {PRESETS[scope].map((p) => (
          <Button key={p.label} small icon="plus" onClick={() => edit((d) => void d.push(p.make()))}>
            {p.label}
          </Button>
        ))}
        <Button small icon="plus" variant="ghost" onClick={() => edit((d) => void d.push(zEffect.parse({ id: newId(), trigger: scope === "unit" ? "turnStart" : "onHit" })))}>
          Blank rule
        </Button>
      </div>
    </div>
  );
}

/** Read-only, game-style preview of a list of effects. */
export function EffectsPreview({ effects, prefix }: { effects: Effect[]; prefix?: string }) {
  const nameOf = useStatusName();
  if (!effects.length) return null;
  return (
    <>
      {effects.map((e) => {
        const text = describeEffect(e, nameOf);
        const tag = text.match(/^\[[^\]]+\]/)?.[0];
        return (
          <p key={e.id}>
            {prefix && <span className="muted">{prefix} </span>}
            {tag ? (
              <>
                <span className="tag">{tag}</span> {text.slice(tag.length).trim()}
              </>
            ) : (
              text
            )}
          </p>
        );
      })}
    </>
  );
}
