// Skill, coin and passive editors with live game-style previews.
import { useState } from "react";
import { DMG_LABEL, LIMITS, SIN_COLOR, SIN_LABEL, SINS } from "../../engine/constants";
import { COIN_KINDS, SKILL_KINDS, type Passive, type Skill } from "../../data/schema";
import { powerRange } from "../../engine/odds";
import { Button, Check, NumberInput, Select, TextArea, TextInput } from "../../ui/controls";
import { SinBadge, SinPicker, DMG_OPTIONS } from "../../ui/game";
import { EffectsPreview, RulesEditor, type Edit } from "./rules";

const KIND_LABEL: Record<Skill["kind"], string> = { attack: "Attack", guard: "Guard", evade: "Evade", counter: "Counter" };
const COIN_LABEL: Record<(typeof COIN_KINDS)[number], string> = { normal: "Normal", unbreakable: "Unbreakable", excision: "Excision" };

export function skillSummary(s: Skill): string {
  const n = s.coins.length;
  const cp = s.coinPower >= 0 ? `+${s.coinPower}` : `${s.coinPower}`;
  return `${s.basePower} ${cp} ×${n} coin${n === 1 ? "" : "s"}`;
}

export function SkillPreview({ s, level }: { s: Skill; level?: number }) {
  const range = powerRange(s.basePower, s.coinPower, s.coins.length);
  return (
    <div className="preview" aria-label="Preview">
      <p>
        <strong>{s.name || "Unnamed skill"}</strong> · {s.sin ? SIN_LABEL[s.sin] : "No affinity"} · {s.kind === "attack" || s.kind === "counter" ? DMG_LABEL[s.dmgType] : KIND_LABEL[s.kind]}
        {s.clashable ? " (Clashable)" : ""} · <span className="mono">{skillSummary(s)}</span>
      </p>
      <p className="muted small">
        Power {range.min}–{range.max}
        {level ? ` · ${s.kind === "attack" || s.kind === "counter" ? "Offense" : "Defense"} Level ${level + s.levelMod} (${level}${s.levelMod >= 0 ? "+" : ""}${s.levelMod})` : ""} · Atk Weight {s.atkWeight}
        {s.unclashable ? " · Unclashable" : ""}
        {s.indiscriminate ? " · Indiscriminate" : ""}
      </p>
      <EffectsPreview effects={s.effects} />
      {s.coins.map((c, i) =>
        c.effects.length || c.kind !== "normal" ? (
          <div key={i}>
            <p className="small" style={{ margin: "6px 0 0" }}>
              <strong>Coin {i + 1}</strong>
              {c.kind !== "normal" ? ` · ${COIN_LABEL[c.kind]} Coin` : ""}
            </p>
            <EffectsPreview effects={c.effects} />
          </div>
        ) : null,
      )}
    </div>
  );
}

export function SkillEditor({
  s, edit, title, context, onRemove, level, defaultOpen = false,
}: {
  s: Skill;
  edit: Edit<Skill>;
  title: string;
  context: "identity" | "defense" | "enemy" | "ego";
  onRemove?: () => void;
  level?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isAttackish = s.kind === "attack" || s.kind === "counter";
  const maxCoins = context === "ego" ? LIMITS.coins.egoMax : 12;
  const coinWarn = context !== "ego" && s.coins.length > LIMITS.coins.max ? `Most base skills have 1–${LIMITS.coins.max} coins.` : undefined;
  const lvlWarn = s.levelMod < LIMITS.levelMod.min || s.levelMod > LIMITS.levelMod.max ? `The game's skill modifiers range from ${LIMITS.levelMod.min} to +${LIMITS.levelMod.max}.` : undefined;
  const sinWarn = s.kind === "attack" && !s.sin ? "Attack skills normally have a sin affinity (it decides resources and Resonance)." : undefined;
  const bodyId = `skill-${s.id}`;
  return (
    <div className="skill" style={{ ["--sin" as string]: s.sin ? SIN_COLOR[s.sin] : "var(--line)" }}>
      <div className="skill-head">
        <button type="button" className="btn ghost small" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)} style={{ paddingLeft: 6 }}>
          <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
          <span className="muted small">{title}</span>
        </button>
        <span className="name">{s.name || "Unnamed"}</span>
        <SinBadge sin={s.sin} />
        <span className="badge">{isAttackish ? DMG_LABEL[s.dmgType] : KIND_LABEL[s.kind]}</span>
        <span className="power-line">{skillSummary(s)}</span>
        {context === "identity" && <span className="badge">×{s.amount} in deck</span>}
        {(coinWarn || lvlWarn || sinWarn) && <span className="badge warn">check</span>}
        <span className="spacer" />
        {onRemove && <Button icon="trash" small variant="ghost" label={`Delete ${title}`} onClick={onRemove} />}
      </div>
      {open && (
        <div className="skill-body" id={bodyId}>
          <div className="fields">
            <TextInput label="Name" className="span-2" value={s.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
            {(context === "defense" || context === "enemy") && (
              <Select label="Kind" value={s.kind} onChange={(v) => edit((d) => void (d.kind = v))} options={SKILL_KINDS.filter((k) => context === "enemy" || k !== "attack").map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
            )}
            {(s.kind === "guard" || s.kind === "counter") && (
              <Check label={`Clashable ${KIND_LABEL[s.kind]}`} checked={s.clashable} onChange={(v) => edit((d) => void (d.clashable = v))} hint="Can Clash with incoming attacks." />
            )}
            <SinPicker label="Sin affinity" value={s.sin} onChange={(v) => edit((d) => void (d.sin = v))} allowNone={s.kind !== "attack" || context === "enemy"} />
            {isAttackish && <Select label="Damage type" value={s.dmgType} onChange={(v) => edit((d) => void (d.dmgType = v))} options={DMG_OPTIONS} />}
            <NumberInput label="Base Power" value={s.basePower} onChange={(n) => edit((d) => void (d.basePower = n), "bp")} min={-99} max={999} info="The skill's starting Power before any coin flips." />
            <NumberInput label="Coin Power" value={s.coinPower} onChange={(n) => edit((d) => void (d.coinPower = n), "cp")} min={-99} max={99} info="Added for every coin that lands Heads. Negative values make a Minus Coin skill." />
            <NumberInput
              label="Coins"
              value={s.coins.length}
              min={1}
              max={maxCoins}
              warn={coinWarn}
              onChange={(n) =>
                edit((d) => {
                  while (d.coins.length < n) d.coins.push({ kind: "normal", effects: [] });
                  while (d.coins.length > n) d.coins.pop();
                })
              }
            />
            <NumberInput
              label={isAttackish ? "Offense Level modifier" : "Defense Level modifier"}
              value={s.levelMod}
              onChange={(n) => edit((d) => void (d.levelMod = n), "lvl")}
              min={-30}
              max={30}
              warn={lvlWarn}
              info="Added to the unit's Level. Every 3 levels of difference in a Clash gives +1 Clash Power; the gap also changes damage by (Off − Def)/(|Off − Def| + 25)."
            />
            {isAttackish && <NumberInput label="Atk Weight" value={s.atkWeight} onChange={(n) => edit((d) => void (d.atkWeight = n))} min={1} max={12} info="How many targets (Skill Slots) it can hit." />}
            {context === "identity" && <NumberInput label="Copies in deck" value={s.amount} onChange={(n) => edit((d) => void (d.amount = n))} min={0} max={9} info="How many copies go into the 'List of Upcoming Skills'. The game uses 3 / 2 / 1 for Skills 1 / 2 / 3." />}
            {isAttackish && <Check label="Unclashable" checked={s.unclashable} onChange={(v) => edit((d) => void (d.unclashable = v))} />}
            {(context === "ego" || context === "enemy") && <Check label="Indiscriminate (may hit allies)" checked={s.indiscriminate} onChange={(v) => edit((d) => void (d.indiscriminate = v))} />}
          </div>
          {sinWarn && <p className="small" style={{ color: "var(--warn)" }}>{sinWarn}</p>}

          <h4 style={{ marginTop: 16 }}>Coins</h4>
          {s.coins.map((c, i) => (
            <div className="coin-row" key={i}>
              <div className="row">
                <span className={`coin-dot ${c.kind}`} aria-hidden>
                  {i + 1}
                </span>
                <strong>Coin {i + 1}</strong>
                <div style={{ width: 180 }}>
                  <Select label={`Coin ${i + 1} type`} value={c.kind} onChange={(v) => edit((d) => void (d.coins[i].kind = v))} options={COIN_KINDS.map((k) => ({ value: k, label: COIN_LABEL[k] }))} />
                </div>
              </div>
              <RulesEditor
                scope="coin"
                effects={c.effects}
                edit={(fn, k) => edit((d) => fn(d.coins[i].effects), k)}
                emptyText="No coin effects."
              />
            </div>
          ))}
          <p className="small muted">Unbreakable coins crack instead of breaking when they lose a Clash, then still hit with Coin Power fixed to 1. Excision coins also destroy enemy Unbreakable coins.</p>

          <h4 style={{ marginTop: 16 }}>Skill effects</h4>
          <RulesEditor scope="skill" effects={s.effects} edit={(fn, k) => edit((d) => fn(d.effects), k)} emptyText="No skill-wide effects. Use these for [On Use], [Clash Win] and constant bonuses." />

          <h4 style={{ marginTop: 16 }}>Preview</h4>
          <SkillPreview s={s} level={level} />
          <div style={{ marginTop: 12 }}>
            <TextArea label="Notes" value={s.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={2} />
          </div>
        </div>
      )}
    </div>
  );
}

export function PassiveEditor({ p, edit, onRemove, allowSupport = true }: { p: Passive; edit: Edit<Passive>; onRemove: () => void; allowSupport?: boolean }) {
  const [open, setOpen] = useState(false);
  const req = p.reqMode === "none" ? "No requirement" : `${SIN_LABEL[p.reqSin]} ×${p.reqCount} ${p.reqMode === "res" ? "Resonance" : "Owned"}`;
  return (
    <div className="skill" style={{ ["--sin" as string]: p.reqMode === "none" ? "var(--gold)" : SIN_COLOR[p.reqSin] }}>
      <div className="skill-head">
        <button type="button" className="btn ghost small" aria-expanded={open} onClick={() => setOpen(!open)} style={{ paddingLeft: 6 }}>
          <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}>›</span>
          <span className="muted small">{p.kind === "support" ? "Support passive" : "Combat passive"}</span>
        </button>
        <span className="name">{p.name || "Unnamed passive"}</span>
        <span className="badge">{req}</span>
        <span className="spacer" />
        <Button icon="trash" small variant="ghost" label="Delete passive" onClick={onRemove} />
      </div>
      {!open && (
        <div className="skill-body">
          <div className="preview">
            <EffectsPreview effects={p.effects} />
            {!p.effects.length && <p className="muted">No effects yet.</p>}
          </div>
        </div>
      )}
      {open && (
        <div className="skill-body">
          <div className="fields">
            <TextInput label="Name" className="span-2" value={p.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
            {allowSupport && (
              <Select
                label="Type"
                value={p.kind}
                onChange={(v) => edit((d) => void (d.kind = v))}
                options={[{ value: "combat", label: "Combat (while deployed)" }, { value: "support", label: "Support (while benched)" }]}
                info="Combat passives work while the Identity is fighting. Support passives work when it is on the team but not deployed."
              />
            )}
            <Select
              label="Requirement"
              value={p.reqMode}
              onChange={(v) => edit((d) => void (d.reqMode = v))}
              options={[{ value: "none", label: "None (always on)" }, { value: "res", label: "Sin Resonance this turn (Res)" }, { value: "owned", label: "Owned E.G.O resources" }]}
              info="Checked at Combat Start each turn. 'Res' counts skills of that sin chained this turn; 'Owned' counts E.G.O resources you hold."
            />
            {p.reqMode !== "none" && (
              <>
                <Select label="Sin" value={p.reqSin} onChange={(v) => edit((d) => void (d.reqSin = v))} options={SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))} />
                <NumberInput label="Amount" value={p.reqCount} onChange={(n) => edit((d) => void (d.reqCount = n))} min={1} max={30} />
              </>
            )}
          </div>
          <h4 style={{ marginTop: 14 }}>Effects</h4>
          <RulesEditor scope="unit" effects={p.effects} edit={(fn, k) => edit((d) => fn(d.effects), k)} />
          <div style={{ marginTop: 12 }}>
            <TextArea label="Notes" value={p.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={2} />
          </div>
        </div>
      )}
    </div>
  );
}
