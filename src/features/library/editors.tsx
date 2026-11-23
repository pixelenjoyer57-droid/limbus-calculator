import { DMG_LABEL, DMG_TYPES, EGO_GRADES, LIMITS, RARITY_LABEL, SIN_LABEL, SINS, type DmgType, type Sin } from "../../engine/constants";
import { overclockCost } from "../../engine/formulas";
import { identitySkillSlot, moveItem, newCoin, newId, zPart, zPassive, type Ego, type Enemy, type Identity, type Part } from "../../data/schema";
import { newSkill } from "../../data/defaults";
import { Button, Check, NumberInput, Select, TagInput, TextArea, TextInput } from "../../ui/controls";
import { Notice, Section } from "../../ui/layout";
import { ResistField, SINNER_OPTIONS } from "../../ui/game";
import { PassiveEditor, SkillEditor } from "./skills";
import type { Edit } from "./rules";

// ---------------------------------------------------------------------------------
export function ThresholdsEditor({ values, onChange, maxHp, sinner }: { values: number[]; onChange: (v: number[]) => void; maxHp: number; sinner?: boolean }) {
  const sorted = [...values].sort((a, b) => b - a);
  return (
    <div className="field full" style={{ gridColumn: "1 / -1" }}>
      <span className="label">Stagger Thresholds (% of max HP)</span>
      <div className="row">
        {sorted.map((v, i) => (
          <span className="chip" key={i}>
            {v}% ({Math.floor((maxHp * v) / 100)} HP)
            <button type="button" aria-label={`Remove ${v}% threshold`} onClick={() => onChange(sorted.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        {!sorted.length && <span className="muted small">None — this unit can't be Staggered by damage.</span>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {[80, 65, 50, 35, 20, 15].filter((p) => !sorted.includes(p)).map((p) => (
          <Button key={p} small onClick={() => onChange([...sorted, p])}>
            + {p}%
          </Button>
        ))}
      </div>
      {sinner && sorted.length > LIMITS.staggerThresholds.sinnerMax && <span className="warn">Sinners have 1 to 3 Stagger Thresholds.</span>}
      <span className="hint">Passing a threshold Staggers the unit. Passing more in the same turn makes it Stagger+ / Stagger++.</span>
    </div>
  );
}

function PhysResist({ value, set }: { value: Record<DmgType, number>; set: (k: DmgType, v: number) => void }) {
  return (
    <div className="fields wide">
      {DMG_TYPES.map((d) => (
        <ResistField key={d} label={DMG_LABEL[d]} value={value[d]} onChange={(v) => set(d, v)} />
      ))}
    </div>
  );
}

function SinResist({ value, set }: { value: Record<Sin, number>; set: (k: Sin, v: number) => void }) {
  return (
    <div className="fields wide">
      {SINS.map((s) => (
        <ResistField key={s} label={SIN_LABEL[s]} value={value[s]} onChange={(v) => set(s, v)} />
      ))}
    </div>
  );
}

export function identityWarnings(x: Identity): string[] {
  const w: string[] = [];
  if (x.speedMax < x.speedMin) w.push("Speed max is lower than Speed min.");
  if (x.staggerThresholds.length > 3) w.push("Sinners have 1–3 Stagger Thresholds.");
  const have = new Set(x.skills.map((s, i) => identitySkillSlot(s, i)));
  for (const slot of ["S1", "S2", "S3"]) if (!have.has(slot as "S1")) w.push(`No skill in slot ${slot}.`);
  for (const [i, s] of x.skills.entries()) {
    const n = s.name || `Skill ${i + 1}`;
    if (s.levelMod < LIMITS.levelMod.min || s.levelMod > LIMITS.levelMod.max) w.push(`${n}: level modifier outside −8…+6.`);
    if (s.coins.length > LIMITS.coins.max) w.push(`${n}: more than ${LIMITS.coins.max} coins.`);
    if (!s.sin) w.push(`${n}: no sin affinity.`);
  }
  if (!x.defense.length) w.push("No Defense skill.");
  for (const r of Object.values(x.resist)) if (r > 2) w.push("A resistance is above Fatal ×2.");
  return Array.from(new Set(w));
}

export function IdentityEditor({ item: x, edit }: { item: Identity; edit: Edit<Identity> }) {
  const warnings = identityWarnings(x);
  return (
    <div className="stack">
      {warnings.length > 0 && (
        <Notice kind="warn">
          <strong>Things to check ({warnings.length})</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: "1.2em" }}>
            {warnings.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Section id="id-basics" title="Basics" summary={`${x.sinner} · ${RARITY_LABEL[x.rarity]}`}>
        <div className="fields">
          <TextInput label="Identity name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <Select label="Sinner" value={x.sinner} onChange={(v) => edit((d) => void (d.sinner = v))} options={SINNER_OPTIONS} />
          <Select label="Rarity" value={String(x.rarity)} onChange={(v) => edit((d) => void (d.rarity = Number(v)))} options={[1, 2, 3].map((r) => ({ value: String(r), label: RARITY_LABEL[r] }))} />
          <TagInput
            label="Traits"
            className="full"
            value={x.traits}
            onChange={(v) => edit((d) => void (d.traits = v), "traits")}
            hint="Factions or keywords, e.g. 'Zwei Association'. Conditions and event bonuses can check them."
          />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
        </div>
      </Section>
      <Section id="id-stats" title="Stats" summary={`HP ${x.hp} · Speed ${x.speedMin}–${x.speedMax} · Def ${x.level + x.defenseMod}`}>
        <div className="fields">
          <NumberInput label="Stats are for level" value={x.level} onChange={(n) => edit((d) => void (d.level = n), "lvl")} min={1} max={200} info="The level the HP below is written for. Team members can use other levels; HP then scales by 'HP per level'." />
          <NumberInput label="HP at that level" value={x.hp} onChange={(n) => edit((d) => void (d.hp = n), "hp")} min={1} max={99999} />
          <NumberInput label="HP per level" value={x.hpPerLevel} onChange={(n) => edit((d) => void (d.hpPerLevel = n), "hpl")} min={0} max={100} decimals={2} step={0.1} info="HP = Base + Mult × Level (Battles page)." />
          <NumberInput label="Speed min" value={x.speedMin} onChange={(n) => edit((d) => void (d.speedMin = n), "smin")} min={1} max={99} />
          <NumberInput label="Speed max" value={x.speedMax} onChange={(n) => edit((d) => void (d.speedMax = n), "smax")} min={1} max={99} warn={x.speedMax < x.speedMin ? "Lower than Speed min." : undefined} />
          <NumberInput
            label="Defense Level modifier"
            value={x.defenseMod}
            onChange={(n) => edit((d) => void (d.defenseMod = n), "def")}
            min={-30}
            max={30}
            hint={`Defense Level ${x.level + x.defenseMod} at level ${x.level}`}
            info="Defense Level = Level + modifier. Used when this unit is hit without a Defense skill."
          />
          <ThresholdsEditor values={x.staggerThresholds} maxHp={x.hp} sinner onChange={(v) => edit((d) => void (d.staggerThresholds = v))} />
        </div>
      </Section>
      <Section id="id-res" title="Resistances" summary={DMG_TYPES.map((d) => `${DMG_LABEL[d][0]}${x.resist[d]}`).join(" · ")}>
        <PhysResist value={x.resist} set={(k, v) => edit((d) => void (d.resist[k] = v))} />
        <p className="small muted" style={{ marginTop: 10 }}>
          Sin resistances of Sinners come from their E.G.O: the equipped ZAYIN at the start of a fight, then the last E.G.O used.
        </p>
      </Section>
      <Section id="id-skills" title="Attack skills" summary={x.skills.map((s) => s.name).join(" · ")}>
        {x.skills.map((s, i) => {
          const slot = identitySkillSlot(s, i);
          const variant = x.skills.some((o, j) => j < i && identitySkillSlot(o, j) === slot);
          const base = i < 3 && !s.slot ? `Skill ${i + 1}` : "Extra skill";
          return (
            <SkillEditor
              key={s.id}
              s={s}
              title={`${base} · ${slot}${variant ? " variant" : ""}`}
              context="identity"
              level={x.level}
              edit={(fn, k) => edit((d) => fn(d.skills[i]), k ? `s${i}-${k}` : undefined)}
              defaultOpen={false}
              onMove={(dir) => edit((d) => moveItem(d.skills, i, dir))}
              canMoveUp={i > 0}
              canMoveDown={i < x.skills.length - 1}
              onRemove={() => edit((d) => void d.skills.splice(i, 1))}
              removeDisabled={x.skills.length <= 1}
              extra={
                <div className="fields" style={{ marginBottom: 10 }}>
                  <Select
                    label="Slot"
                    value={s.slot ?? ""}
                    onChange={(v) => edit((d) => void (d.skills[i].slot = v === "" ? null : (v as "S1" | "S2" | "S3")))}
                    options={[
                      { value: "", label: "By position (S1/S2/S3)" },
                      { value: "S1", label: "S1" },
                      { value: "S2", label: "S2" },
                      { value: "S3", label: "S3" },
                    ]}
                    hint="Two skills in the same slot are variants: each has its own copies in the deck."
                  />
                </div>
              }
            />
          );
        })}
        {x.skills.length < 6 && (
          <Button small icon="plus" onClick={() => edit((d) => void d.skills.push(newSkill({ name: "New skill", sin: "WRATH", dmgType: "SLASH", basePower: 4, coinPower: 4, coins: [newCoin(), newCoin()], amount: 1 })))}>
            Add skill
          </Button>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>Skills in the S3 slot unlock at Uptie 3. Copies in the deck: 3 / 2 / 1 by default; each skill keeps its own count. Position decides the slot unless you pick one.</p>
      </Section>
      <Section id="id-def" title="Defense skills" summary={x.defense.map((s) => s.name).join(" · ") || "none"}>
        {x.defense.map((s, i) => (
          <SkillEditor
            key={s.id}
            s={s}
            title={`Defense ${x.defense.length > 1 ? i + 1 : ""}`}
            context="defense"
            level={x.level}
            edit={(fn, k) => edit((d) => fn(d.defense[i]), k ? `d${i}-${k}` : undefined)}
            onRemove={() => edit((d) => void d.defense.splice(i, 1))}
            onMove={(dir) => edit((d) => moveItem(d.defense, i, dir))}
            canMoveUp={i > 0}
            canMoveDown={i < x.defense.length - 1}
          />
        ))}
        {x.defense.length < 3 && (
          <Button small icon="plus" onClick={() => edit((d) => void d.defense.push(newSkill({ name: "Guard", kind: "guard", sin: null, basePower: 7, coinPower: 3, amount: 0 })))}>
            Add defense skill
          </Button>
        )}
      </Section>
      <Section id="id-passives" title="Passives" summary={`${x.passives.length} passive${x.passives.length === 1 ? "" : "s"}`}>
        {x.passives.map((p, i) => (
          <PassiveEditor key={p.id} p={p} edit={(fn, k) => edit((d) => fn(d.passives[i]), k ? `p${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.passives.splice(i, 1))} />
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <Button small icon="plus" onClick={() => edit((d) => void d.passives.push(zPassive.parse({ id: newId(), name: "Combat Passive", kind: "combat" })))}>
            Combat passive
          </Button>
          <Button small icon="plus" onClick={() => edit((d) => void d.passives.push(zPassive.parse({ id: newId(), name: "Support Passive", kind: "support" })))}>
            Support passive
          </Button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Combat passives unlock at Uptie 2 and Support passives at Uptie 3.</p>
      </Section>
      <Section id="id-notes" title="Notes" defaultOpen={false} summary={x.notes ? "has notes" : "empty"}>
        <TextArea label="Design notes" value={x.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={5} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------
export function EgoEditor({ item: x, edit }: { item: Ego; edit: Edit<Ego> }) {
  const costText = SINS.filter((s) => x.cost[s] > 0).map((s) => `${SIN_LABEL[s]} ×${x.cost[s]}`).join(", ") || "free";
  return (
    <div className="stack">
      <Section id="ego-basics" title="Basics" summary={`${x.sinner} · ${x.grade}`}>
        <div className="fields">
          <TextInput label="E.G.O name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <Select label="Sinner" value={x.sinner} onChange={(v) => edit((d) => void (d.sinner = v))} options={SINNER_OPTIONS} />
          <Select label="Grade" value={x.grade} onChange={(v) => edit((d) => void (d.grade = v))} options={EGO_GRADES.map((g) => ({ value: g, label: g }))} info="One E.G.O of each grade can be equipped per Sinner. Every Sinner's ZAYIN sets their starting Sin resistances." />
          <NumberInput label="SP cost" value={x.spCost} onChange={(n) => edit((d) => void (d.spCost = n), "sp")} min={0} max={999} info="Paid on use. Ending at −23 SP or lower risks Corrosion: 25% (−23…−33), 75% (−34…−44), 100% at −45." />
        </div>
      </Section>
      <Section id="ego-cost" title="E.G.O resource cost" summary={costText}>
        <div className="fields">
          {SINS.map((s) => (
            <NumberInput key={s} label={SIN_LABEL[s]} value={x.cost[s]} onChange={(n) => edit((d) => void (d.cost[s] = n), "cost-" + s)} min={0} max={30} />
          ))}
        </div>
        <p className="small muted">Overclock (uses the Corrosion skill safely) costs ×1.5 rounded up: {SINS.filter((s) => x.cost[s] > 0).map((s) => `${SIN_LABEL[s]} ×${overclockCost(x.cost[s])}`).join(", ") || "—"}, {overclockCost(x.spCost)} SP.</p>
      </Section>
      <Section id="ego-res" title="Sin resistances (given to the Sinner)" summary="used after this E.G.O is used">
        <SinResist value={x.sinResist} set={(k, v) => edit((d) => void (d.sinResist[k] = v))} />
      </Section>
      <Section id="ego-skills" title="Skills" summary={[x.awakening.name, x.corrosion?.name].filter(Boolean).join(" · ")}>
        <SkillEditor s={x.awakening} title="Awakening" context="ego" edit={(fn, k) => edit((d) => fn(d.awakening), k ? `aw-${k}` : undefined)} defaultOpen />
        {x.corrosion ? (
          <SkillEditor s={x.corrosion} title="Corrosion" context="ego" edit={(fn, k) => edit((d) => fn(d.corrosion!), k ? `co-${k}` : undefined)} onRemove={() => edit((d) => void (d.corrosion = null))} />
        ) : (
          <Button small icon="plus" onClick={() => edit((d) => void (d.corrosion = newSkill({ name: "Corrosion", sin: x.awakening.sin, dmgType: x.awakening.dmgType, basePower: x.awakening.basePower + 4, coinPower: x.awakening.coinPower, coins: structuredClone(x.awakening.coins), indiscriminate: true, amount: 0 })))}>
            Add Corrosion skill
          </Button>
        )}
      </Section>
      <Section id="ego-passive" title="E.G.O passive" summary={x.passive ? x.passive.name : "none"}>
        {x.passive ? (
          <PassiveEditor p={x.passive} allowSupport={false} edit={(fn, k) => edit((d) => fn(d.passive!), k ? `pa-${k}` : undefined)} onRemove={() => edit((d) => void (d.passive = null))} />
        ) : (
          <Button small icon="plus" onClick={() => edit((d) => void (d.passive = zPassive.parse({ id: newId(), name: "E.G.O Passive" })))}>
            Add passive
          </Button>
        )}
        <p className="small muted">E.G.O passives turn on the turn after the E.G.O is used and stay on for the rest of the fight.</p>
      </Section>
      <Section id="ego-notes" title="Notes" defaultOpen={false}>
        <TextArea label="Notes" value={x.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={4} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------
function PartEditor({ p, edit, onRemove }: { p: Part; edit: Edit<Part>; onRemove: () => void }) {
  return (
    <Section id={`part-${p.id}`} title={p.name || "Part"} summary={`HP ${p.hp} · ${p.breakable} · ${p.slots} slot${p.slots === 1 ? "" : "s"}`} actions={<Button icon="trash" small variant="ghost" label={`Delete part ${p.name}`} onClick={onRemove} />}>
      <div className="fields">
        <TextInput label="Part name" value={p.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
        <NumberInput label="Part HP" value={p.hp} onChange={(n) => edit((d) => void (d.hp = n), "hp")} min={1} max={999999} />
        <NumberInput label="Defense modifier" value={p.defenseMod} onChange={(n) => edit((d) => void (d.defenseMod = n), "def")} min={-30} max={30} />
        <NumberInput label="Skill slots" value={p.slots} onChange={(n) => edit((d) => void (d.slots = n))} min={0} max={8} />
        <Select
          label="When broken"
          value={p.breakable}
          onChange={(v) => edit((d) => void (d.breakable = v))}
          options={[{ value: "destructible", label: "Destructible (Fatal ×2, keeps acting)" }, { value: "severable", label: "Severable (removed)" }, { value: "indestructible", label: "Indestructible (heals next turn)" }]}
        />
      </div>
      <h4 style={{ marginTop: 12 }}>Physical resistances</h4>
      <PhysResist value={p.resist} set={(k, v) => edit((d) => void (d.resist[k] = v))} />
      <h4 style={{ marginTop: 12 }}>Sin resistances</h4>
      <SinResist value={p.sinResist} set={(k, v) => edit((d) => void (d.sinResist[k] = v))} />
      <h4 style={{ marginTop: 12 }}>Skills of this part</h4>
      {p.skills.map((s, i) => (
        <SkillEditor key={s.id} s={s} title={`Skill ${i + 1}`} context="enemy" edit={(fn, k) => edit((d) => fn(d.skills[i]), k ? `ps${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.skills.splice(i, 1))} />
      ))}
      <Button small icon="plus" onClick={() => edit((d) => void d.skills.push(newSkill({ name: "Part skill", amount: 0 })))}>
        Add skill
      </Button>
    </Section>
  );
}

export function EnemyEditor({ item: x, edit }: { item: Enemy; edit: Edit<Enemy> }) {
  const multi = x.parts.length > 0;
  const skillOpts = x.skills.map((s) => ({ value: s.id, label: s.name }));
  return (
    <div className="stack">
      <Section id="en-basics" title="Basics" summary={`Lv ${x.level} · HP ${x.hp}${multi ? ` · ${x.parts.length} parts` : ""}`}>
        <div className="fields">
          <TextInput label="Enemy name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <NumberInput label="Level" value={x.level} onChange={(n) => edit((d) => void (d.level = n), "lvl")} min={1} max={999} info="Offense and Defense Level start at the unit's Level." />
          <NumberInput label={multi ? "Core HP" : "HP"} value={x.hp} onChange={(n) => edit((d) => void (d.hp = n), "hp")} min={1} max={9999999} info={multi ? "Damage to any Part also hits the Core. The enemy is defeated when the Core reaches 0." : undefined} />
          <NumberInput label="Speed min" value={x.speedMin} onChange={(n) => edit((d) => void (d.speedMin = n), "smin")} min={1} max={99} />
          <NumberInput label="Speed max" value={x.speedMax} onChange={(n) => edit((d) => void (d.speedMax = n), "smax")} min={1} max={99} warn={x.speedMax < x.speedMin ? "Lower than Speed min." : undefined} />
          {!multi && <NumberInput label="Defense modifier" value={x.defenseMod} onChange={(n) => edit((d) => void (d.defenseMod = n), "def")} min={-30} max={30} hint={`Defense Level ${x.level + x.defenseMod}`} />}
          <ThresholdsEditor values={x.staggerThresholds} maxHp={x.hp} onChange={(v) => edit((d) => void (d.staggerThresholds = v))} />
        </div>
      </Section>
      <Section id="en-sanity" title="Sanity" summary={x.hasSanity ? `starts at ${x.startSp} SP` : "no Sanity (50% Heads)"}>
        <div className="fields">
          <Check label="Has Sanity (SP)" checked={x.hasSanity} onChange={(v) => edit((d) => void (d.hasSanity = v))} hint="Without Sanity, coins are always 50/50 and Sinking deals Gloom damage instead of SP damage." />
          {x.hasSanity && (
            <>
              <NumberInput label="Starting SP" value={x.startSp} onChange={(n) => edit((d) => void (d.startSp = n))} min={-45} max={45} />
              <Check label="Panic Recovery" checked={x.panicRecovery} onChange={(v) => edit((d) => void (d.panicRecovery = v))} hint="After Panicking, reset SP to 0 like Sinners do." />
            </>
          )}
        </div>
      </Section>
      {!multi && (
        <>
          <Section id="en-res" title="Resistances" summary="damage types and sins">
            <h4>Physical</h4>
            <PhysResist value={x.resist} set={(k, v) => edit((d) => void (d.resist[k] = v))} />
            <h4 style={{ marginTop: 12 }}>Sin</h4>
            <SinResist value={x.sinResist} set={(k, v) => edit((d) => void (d.sinResist[k] = v))} />
          </Section>
          <Section id="en-skills" title="Skills" summary={`${x.skills.length} skill${x.skills.length === 1 ? "" : "s"} · ${x.slots}→${x.slotsMax} slots`}>
            <div className="fields" style={{ marginBottom: 12 }}>
              <NumberInput label="Skill slots on turn 1" value={x.slots} onChange={(n) => edit((d) => void (d.slots = n))} min={0} max={12} />
              <NumberInput label="Max skill slots" value={x.slotsMax} onChange={(n) => edit((d) => void (d.slotsMax = n))} min={0} max={12} hint="Gains 1 slot per turn up to this." />
              <Select label="Skill choice" value={x.pattern} onChange={(v) => edit((d) => void (d.pattern = v))} options={[{ value: "random", label: "Random each turn" }, { value: "rotation", label: "Fixed rotation" }]} />
            </div>
            {x.skills.map((s, i) => (
              <SkillEditor key={s.id} s={s} title={`Skill ${i + 1}`} context="enemy" level={x.level} edit={(fn, k) => edit((d) => fn(d.skills[i]), k ? `s${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.skills.splice(i, 1))} />
            ))}
            <Button small icon="plus" onClick={() => edit((d) => void d.skills.push(newSkill({ name: `Skill ${x.skills.length + 1}`, amount: 0 })))}>
              Add skill
            </Button>
            {x.pattern === "rotation" && (
              <div style={{ marginTop: 14 }}>
                <h4>Rotation (repeats)</h4>
                {x.rotation.map((turn, ti) => (
                  <div key={ti} className="row" style={{ alignItems: "flex-end", marginBottom: 8 }}>
                    <strong style={{ width: 70 }}>Turn {ti + 1}</strong>
                    {Array.from({ length: Math.max(1, x.slotsMax) }, (_, si) => (
                      <div key={si} style={{ minWidth: 150 }}>
                        <Select label={`Slot ${si + 1}`} value={turn[si] ?? ""} placeholder="(random)" onChange={(v) => edit((d) => void (d.rotation[ti][si] = v))} options={skillOpts} />
                      </div>
                    ))}
                    <Button icon="trash" small variant="ghost" label={`Remove turn ${ti + 1}`} onClick={() => edit((d) => void d.rotation.splice(ti, 1))} />
                  </div>
                ))}
                <Button small icon="plus" onClick={() => edit((d) => void d.rotation.push([]))}>
                  Add turn
                </Button>
              </div>
            )}
          </Section>
        </>
      )}
      <Section id="en-parts" title="Parts (Focused Encounter)" summary={multi ? `${x.parts.length} parts` : "single body"}>
        {!multi && <p className="muted small">Add Parts to make a multi-part Abnormality: each Part has its own HP, resistances and skills, and shares the Core HP.</p>}
        {x.parts.map((p, i) => (
          <PartEditor key={p.id} p={p} edit={(fn, k) => edit((d) => fn(d.parts[i]), k ? `pt${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.parts.splice(i, 1))} />
        ))}
        <Button small icon="plus" onClick={() => edit((d) => void d.parts.push(zPart.parse({ id: newId(), name: `Part ${x.parts.length + 1}`, skills: [newSkill({ name: "Part skill", amount: 0 })] })))}>
          Add part
        </Button>
      </Section>
      <Section id="en-passives" title="Passives" summary={`${x.passives.length}`}>
        {x.passives.map((p, i) => (
          <PassiveEditor key={p.id} p={p} allowSupport={false} edit={(fn, k) => edit((d) => fn(d.passives[i]), k ? `p${i}-${k}` : undefined)} onRemove={() => edit((d) => void d.passives.splice(i, 1))} />
        ))}
        <Button small icon="plus" onClick={() => edit((d) => void d.passives.push(zPassive.parse({ id: newId(), name: "Passive" })))}>
          Add passive
        </Button>
      </Section>
      <Section id="en-notes" title="Notes" defaultOpen={false}>
        <TextArea label="Notes" value={x.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={4} />
      </Section>
    </div>
  );
}
