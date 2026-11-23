import { useState } from "react";
import { DMG_LABEL, DMG_TYPES, GIFT_TIERS, SIN_LABEL, SINS } from "../../engine/constants";
import { BUILTIN_STATUS_LIST, KEYWORD_STATUSES } from "../../engine/statuses";
import { checkOdds } from "../../engine/eventcheck";
import * as R from "../../engine/rng";
import {
  GIFT_KEYWORDS, OUTCOME_KINDS, newId, zEventChoice, zOutcome,
  type CoinType, type CustomStatus, type Encounter, type EventChoice, type GameEvent, type Gift, type Outcome,
} from "../../data/schema";
import { Button, Check, NumberInput, Select, TagInput, TextArea, TextInput } from "../../ui/controls";
import { Notice, Section } from "../../ui/layout";
import { StatusSelect, useStatusName } from "../../ui/game";
import { useWorkspace } from "../../store/workspace";
import { navigate } from "../../lib/router";
import { RulesEditor, type Edit } from "./rules";

// ---------------------------------------------------------------------------------
export function EncounterEditor({ item: x, edit }: { item: Encounter; edit: Edit<Encounter> }) {
  const enemies = useWorkspace((s) => s.ws.enemies);
  const opts = enemies.map((e) => ({ value: e.id, label: `${e.name} (Lv ${e.level})` }));
  const total = x.waves.reduce((a, w) => a + w.enemies.reduce((b, e) => b + e.count, 0), 0);
  return (
    <div className="stack">
      <Section id="enc-basics" title="Basics" summary={`${x.type} · deploy ${x.maxDeploy}`}>
        <div className="fields">
          <TextInput label="Encounter name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <Select
            label="Type"
            value={x.type}
            onChange={(v) => edit((d) => void (d.type = v))}
            options={[
              { value: "normal", label: "Normal (chain battle)" },
              { value: "risky", label: "Risky (chain battle)" },
              { value: "focused", label: "Focused" },
              { value: "abnormality", label: "Abnormality (focused)" },
              { value: "boss", label: "Boss (focused)" },
            ]}
            info="Chain battles give allies extra Skill Slots up to 12 total. Focused fights cap slots at the deploy limit and let faster units redirect attacks freely."
          />
          <NumberInput label="Max deployed Sinners" value={x.maxDeploy} onChange={(n) => edit((d) => void (d.maxDeploy = n))} min={1} max={12} />
          <NumberInput label="Turn limit (0 = none)" value={x.turnLimit} onChange={(n) => edit((d) => void (d.turnLimit = n))} min={0} max={99} />
          <NumberInput label="Starting SP" value={x.startSp} onChange={(n) => edit((d) => void (d.startSp = n))} min={-45} max={45} />
        </div>
      </Section>
      <Section id="enc-waves" title="Waves" summary={`${x.waves.length} wave${x.waves.length === 1 ? "" : "s"} · ${total} enemies`}>
        {!enemies.length && <Notice kind="info">Make an enemy first (Builder → Enemies), then add it here.</Notice>}
        {x.waves.map((w, wi) => (
          <div className="coin-row" key={w.id}>
            <div className="row">
              <strong>Wave {wi + 1}</strong>
              <span className="spacer" />
              {x.waves.length > 1 && <Button icon="trash" small variant="ghost" label={`Remove wave ${wi + 1}`} onClick={() => edit((d) => void d.waves.splice(wi, 1))} />}
            </div>
            {w.enemies.map((e, ei) => (
              <div className="row" key={ei} style={{ alignItems: "flex-end", marginTop: 8 }}>
                <div style={{ flex: 2, minWidth: 180 }}>
                  <Select label="Enemy" value={e.enemyId} placeholder="Pick an enemy" onChange={(v) => edit((d) => void (d.waves[wi].enemies[ei].enemyId = v))} options={opts} />
                </div>
                <div style={{ width: 130 }}>
                  <NumberInput label="How many" value={e.count} onChange={(n) => edit((d) => void (d.waves[wi].enemies[ei].count = n))} min={1} max={10} />
                </div>
                <div style={{ width: 150 }}>
                  <NumberInput label="Level (0 = own)" value={e.level} onChange={(n) => edit((d) => void (d.waves[wi].enemies[ei].level = n))} min={0} max={999} />
                </div>
                <Button icon="trash" small variant="ghost" label="Remove enemy" onClick={() => edit((d) => void d.waves[wi].enemies.splice(ei, 1))} />
              </div>
            ))}
            <Button small icon="plus" onClick={() => edit((d) => void d.waves[wi].enemies.push({ enemyId: enemies[0]?.id ?? "", count: 1, level: 0 }))} className="" >
              Add enemy
            </Button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <Button small icon="plus" onClick={() => edit((d) => void d.waves.push({ id: newId(), enemies: [] }))}>
            Add wave
          </Button>
          <span className="spacer" />
          <Button variant="primary" icon="swords" onClick={() => navigate(`/sim?encounter=${x.id}`)}>
            Fight this encounter
          </Button>
        </div>
        <p className="small muted">The next wave arrives at the start of the turn after the previous wave is defeated. Enemy HP is used as written (it does not scale with the level override).</p>
      </Section>
      <Section id="enc-notes" title="Notes" defaultOpen={false}>
        <TextArea label="Notes" value={x.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={4} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------
const KEYWORD_LABEL: Record<(typeof GIFT_KEYWORDS)[number], string> = {
  NONE: "None", BURN: "Burn", BLEED: "Bleed", TREMOR: "Tremor", RUPTURE: "Rupture", SINKING: "Sinking", POISE: "Poise", CHARGE: "Charge", SLASH: "Slash", PIERCE: "Pierce", BLUNT: "Blunt",
};

export function GiftEditor({ item: x, edit }: { item: Gift; edit: Edit<Gift> }) {
  return (
    <div className="stack">
      <Section id="gift-basics" title="Basics" summary={`Tier ${x.tier} · ${KEYWORD_LABEL[x.keyword]}`}>
        <div className="fields">
          <TextInput label="Gift name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <Select label="Tier" value={x.tier} onChange={(v) => edit((d) => void (d.tier = v))} options={GIFT_TIERS.map((t) => ({ value: t, label: t }))} />
          <Select label="Keyword" value={x.keyword} onChange={(v) => edit((d) => void (d.keyword = v))} options={GIFT_KEYWORDS.map((k) => ({ value: k, label: KEYWORD_LABEL[k] }))} />
          <NumberInput label="Cost" value={x.cost} onChange={(n) => edit((d) => void (d.cost = n))} min={0} max={9999} />
          <Select
            label="Works as"
            value={x.scope}
            onChange={(v) => edit((d) => void (d.scope = v))}
            options={[{ value: "eachAlly", label: "A passive on every ally" }, { value: "team", label: "One team effect" }]}
            info="'Every ally': each Sinner gets the effect (use for 'When an ally hits…'). 'Team': Turn Start / Combat Start / Turn End rules run once per turn (use for 'apply 2 Damage Up to a random ally')."
          />
          <TextArea label="Description (shown as is)" className="full" value={x.notes} onChange={(v) => edit((d) => void (d.notes = v), "notes")} rows={3} />
        </div>
      </Section>
      <Section id="gift-base" title="Effects" summary={`${x.effects.length} rule${x.effects.length === 1 ? "" : "s"}`}>
        <RulesEditor scope="unit" effects={x.effects} edit={(fn, k) => edit((d) => fn(d.effects), k)} />
      </Section>
      {([1, 2] as const).map((lvl) => {
        const key = lvl === 1 ? "plus1" : "plus2";
        const list = x[key];
        return (
          <Section key={key} id={`gift-${key}`} title={`Enhanced ${"+".repeat(lvl)}`} summary={list ? `${list.length} rules` : "not enhanceable"} defaultOpen={false}>
            {list ? (
              <>
                <RulesEditor scope="unit" effects={list} edit={(fn, k) => edit((d) => fn(d[key]!), k)} />
                <Button small variant="danger" onClick={() => edit((d) => void (d[key] = null))}>
                  Remove {"+".repeat(lvl)} version
                </Button>
              </>
            ) : (
              <Button small icon="copy" onClick={() => edit((d) => void (d[key] = structuredClone(lvl === 2 && x.plus1 ? x.plus1 : x.effects).map((e) => ({ ...e, id: newId() }))))}>
                Add {"+".repeat(lvl)} version (copies the current rules)
              </Button>
            )}
          </Section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------
export function StatusEditor({ item: x, edit }: { item: CustomStatus; edit: Edit<CustomStatus> }) {
  return (
    <div className="stack">
      <Section id="st-basics" title="Basics" summary={`${x.polarity} · ${x.mode === "pc" ? "Potency + Count" : "single value"}`}>
        <div className="fields">
          <TextInput label="Status name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <Select label="Kind" value={x.polarity} onChange={(v) => edit((d) => void (d.polarity = v))} options={[{ value: "positive", label: "Positive (buff)" }, { value: "negative", label: "Negative (debuff)" }, { value: "neutral", label: "Neutral" }]} />
          <Select label="Values" value={x.mode} onChange={(v) => edit((d) => void (d.mode = v))} options={[{ value: "value", label: "One value (Stack / Count)" }, { value: "pc", label: "Potency and Count" }]} />
          {x.mode === "pc" && <NumberInput label="Max Potency" value={x.maxPotency} onChange={(n) => edit((d) => void (d.maxPotency = n))} min={1} max={999} />}
          <NumberInput label={x.mode === "pc" ? "Max Count" : "Max value"} value={x.maxCount} onChange={(n) => edit((d) => void (d.maxCount = n))} min={1} max={999} />
          <Select
            label="At Turn End"
            value={x.turnEnd}
            onChange={(v) => edit((d) => void (d.turnEnd = v))}
            options={[
              { value: "none", label: "Nothing" },
              { value: "countMinus1", label: "Lose 1 (Count)" },
              { value: "potencyMinus1", label: "Lose 1 Potency" },
              { value: "halve", label: "Halve (rounded down)" },
              { value: "expire", label: "Expires (lasts one turn)" },
            ]}
          />
          <Select
            label="Counts as (Unique …)"
            value={x.countsAs ?? ""}
            onChange={(v) => edit((d) => void (d.countsAs = v || null))}
            options={[{ value: "", label: "Nothing" }, ...KEYWORD_STATUSES.map((k) => ({ value: k, label: `Unique ${BUILTIN_STATUS_LIST.find((b) => b.key === k)!.name}` }))]}
            info="A 'Unique Burn' counts as Burn for conditions like 'target has Burn' and gift checks. It does not deal Burn damage by itself — write that as a rule below."
          />
          <TextArea label="Description" className="full" value={x.description} onChange={(v) => edit((d) => void (d.description = v), "desc")} rows={3} />
        </div>
      </Section>
      <Section id="st-rules" title="What it does" summary={`${x.effects.length} rule${x.effects.length === 1 ? "" : "s"}`}>
        <p className="small muted">Rules run for the unit that has this status ("self" = the unit carrying it). Use "{x.name || "this status"} Count on self" in a value to scale with stacks.</p>
        <RulesEditor scope="unit" effects={x.effects} edit={(fn, k) => edit((d) => fn(d.effects), k)} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------
const OUTCOME_LABEL: Record<(typeof OUTCOME_KINDS)[number], string> = {
  hp: "Change HP",
  sp: "Change SP",
  status: "Gain a status (next fight)",
  gift: "Get an E.G.O Gift",
  cost: "Change Cost",
  resource: "E.G.O resources",
  text: "Text only",
};

function OutcomeEditor({ o, edit, onRemove }: { o: Outcome; edit: Edit<Outcome>; onRemove: () => void }) {
  const gifts = useWorkspace((s) => s.ws.gifts);
  return (
    <div className="rule-item">
      <div className="fields">
        <Select label="Outcome" value={o.kind} onChange={(v) => edit((d) => void (d.kind = v))} options={OUTCOME_KINDS.map((k) => ({ value: k, label: OUTCOME_LABEL[k] }))} />
        {o.kind !== "text" && o.kind !== "cost" && o.kind !== "gift" && o.kind !== "resource" && (
          <Select label="Who" value={o.target} onChange={(v) => edit((d) => void (d.target = v))} options={[{ value: "chosen", label: "Chosen Sinner" }, { value: "all", label: "All Sinners" }, { value: "random", label: "A random Sinner" }]} />
        )}
        {(o.kind === "hp" || o.kind === "sp" || o.kind === "cost" || o.kind === "resource" || o.kind === "status") && (
          <NumberInput label={o.kind === "status" ? "Amount" : "Change (+/−)"} value={o.amount} onChange={(n) => edit((d) => void (d.amount = n), "amt")} min={-9999} max={9999} />
        )}
        {o.kind === "hp" && <Check label="Percent of max HP" checked={o.pct} onChange={(v) => edit((d) => void (d.pct = v))} />}
        {o.kind === "status" && <StatusSelect value={o.status} onChange={(v) => edit((d) => void (d.status = v))} />}
        {o.kind === "resource" && <Select label="Sin" value={o.sin} onChange={(v) => edit((d) => void (d.sin = v))} options={SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))} />}
        {o.kind === "gift" && <Select label="Gift" value={o.giftId} placeholder="Pick a gift" onChange={(v) => edit((d) => void (d.giftId = v))} options={gifts.map((g) => ({ value: g.id, label: g.name }))} />}
        <TextInput label="Text shown" className="full" value={o.text} onChange={(v) => edit((d) => void (d.text = v), "text")} maxLength={600} />
      </div>
      <Button icon="trash" small variant="ghost" label="Remove outcome" onClick={onRemove} />
    </div>
  );
}

function ChoiceEditor({ c, edit, onRemove, index }: { c: EventChoice; edit: Edit<EventChoice>; onRemove: () => void; index: number }) {
  return (
    <Section id={`choice-${c.id}`} title={`Choice ${index + 1}: ${c.label || "…"}`} summary={c.hasCheck ? `check ${c.checkAtMost ? "≤" : "≥"} ${c.checkTarget}` : "no check"} actions={<Button icon="trash" small variant="ghost" label="Delete choice" onClick={onRemove} />}>
      <div className="fields">
        <TextInput label="Choice text" className="full" value={c.label} onChange={(v) => edit((d) => void (d.label = v), "label")} maxLength={200} />
        <Check label="Needs a Skill Check" checked={c.hasCheck} onChange={(v) => edit((d) => void (d.hasCheck = v))} hint="The chosen Sinner flips the skill with the best chance; the final Power is compared to the target." />
        {c.hasCheck && (
          <>
            <NumberInput label="Target number" value={c.checkTarget} onChange={(n) => edit((d) => void (d.checkTarget = n), "tgt")} min={0} max={999} />
            <Check label="Must roll at or below" checked={c.checkAtMost} onChange={(v) => edit((d) => void (d.checkAtMost = v))} />
            <NumberInput label="Sin advantage (lowers target)" value={c.advantageAmount} onChange={(n) => edit((d) => void (d.advantageAmount = n))} min={0} max={99} />
          </>
        )}
      </div>
      {c.hasCheck && (
        <>
          <div className="field" style={{ marginTop: 8 }}>
            <span className="label">Advantage sins</span>
            <div className="row">
              {SINS.map((s) => (
                <label key={s} className="check" style={{ minHeight: 36 }}>
                  <input
                    type="checkbox"
                    checked={c.advantageSins.includes(s)}
                    onChange={(e) => edit((d) => void (d.advantageSins = e.target.checked ? [...d.advantageSins, s] : d.advantageSins.filter((x) => x !== s)))}
                  />
                  {SIN_LABEL[s]}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="small muted">Bonuses for specific Sinners or traits (added to the final number):</span>
            {c.bonuses.map((b, i) => (
              <div className="row" key={b.id} style={{ alignItems: "flex-end" }}>
                <div style={{ width: 150 }}>
                  <Select label="Match" value={b.match} onChange={(v) => edit((d) => void (d.bonuses[i].match = v))} options={[{ value: "sinner", label: "Sinner" }, { value: "trait", label: "Trait" }]} />
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <TextInput label={b.match === "sinner" ? "Sinner name" : "Trait"} value={b.value} onChange={(v) => edit((d) => void (d.bonuses[i].value = v), `b${i}`)} />
                </div>
                <div style={{ width: 140 }}>
                  <NumberInput label="Bonus" value={b.amount} onChange={(n) => edit((d) => void (d.bonuses[i].amount = n))} min={-99} max={99} />
                </div>
                <Button icon="trash" small variant="ghost" label="Remove bonus" onClick={() => edit((d) => void d.bonuses.splice(i, 1))} />
              </div>
            ))}
            <Button small icon="plus" onClick={() => edit((d) => void d.bonuses.push({ id: newId(), match: "sinner", value: "Yi Sang", amount: 2 }))}>
              Add bonus
            </Button>
          </div>
        </>
      )}
      <div className="rule-block">
        <div className="label">{c.hasCheck ? "On success" : "Result"}</div>
        {c.success.map((o, i) => (
          <OutcomeEditor key={o.id} o={o} edit={(fn, k) => edit((d) => fn(d.success[i]), k ? `s${i}${k}` : undefined)} onRemove={() => edit((d) => void d.success.splice(i, 1))} />
        ))}
        <Button small icon="plus" onClick={() => edit((d) => void d.success.push(zOutcome.parse({ id: newId(), kind: "text" })))}>
          Add outcome
        </Button>
      </div>
      {c.hasCheck && (
        <div className="rule-block">
          <div className="label">On failure</div>
          {c.failure.map((o, i) => (
            <OutcomeEditor key={o.id} o={o} edit={(fn, k) => edit((d) => fn(d.failure[i]), k ? `f${i}${k}` : undefined)} onRemove={() => edit((d) => void d.failure.splice(i, 1))} />
          ))}
          <Button small icon="plus" onClick={() => edit((d) => void d.failure.push(zOutcome.parse({ id: newId(), kind: "text" })))}>
            Add outcome
          </Button>
        </div>
      )}
    </Section>
  );
}

function describeOutcome(o: Outcome, giftName: (id: string) => string, statusName: (k: string) => string): string {
  const who = o.target === "all" ? "All Sinners" : o.target === "random" ? "A random Sinner" : "The chosen Sinner";
  const sign = o.amount >= 0 ? "+" : "";
  switch (o.kind) {
    case "hp":
      return `${who}: ${sign}${o.amount}${o.pct ? "% max" : ""} HP`;
    case "sp":
      return `${who}: ${sign}${o.amount} SP`;
    case "status":
      return `${who} gain ${o.amount} ${statusName(o.status)}`;
    case "gift":
      return `Gain E.G.O Gift: ${giftName(o.giftId)}`;
    case "cost":
      return `${sign}${o.amount} Cost`;
    case "resource":
      return `${sign}${o.amount} ${SIN_LABEL[o.sin]} E.G.O resource`;
    default:
      return "";
  }
}

function EventTester({ ev }: { ev: GameEvent }) {
  const teams = useWorkspace((s) => s.ws.teams);
  const identities = useWorkspace((s) => s.ws.identities);
  const gifts = useWorkspace((s) => s.ws.gifts);
  const statusName = useStatusName();
  const coinTypeList = useWorkspace((s) => s.ws.coinTypes);
  const coinTypes = Object.fromEntries(coinTypeList.map((t) => [t.key, t]));
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [sp, setSp] = useState(0);
  const [result, setResult] = useState<string[] | null>(null);
  const team = teams.find((t) => t.id === teamId);
  const members = team
    ? team.deploy.map((s) => ({ sinner: s, m: team.members[s], idn: identities.find((i) => i.id === team.members[s]?.identityId) })).filter((x) => x.idn)
    : [];
  const giftName = (id: string) => gifts.find((g) => g.id === id)?.name ?? "(missing gift)";
  const run = (c: EventChoice, sinner: string) => {
    const mem = members.find((x) => x.sinner === sinner);
    const lines: string[] = [];
    let ok = true;
    if (c.hasCheck && mem?.idn) {
      const odds = checkOdds(c, mem.idn, sp, mem.m?.uptie ?? 4, coinTypes);
      const rng = R.makeRng(R.randomSeed());
      ok = R.chance(rng, odds.chance);
      lines.push(`${sinner} uses ${odds.skillName} (${Math.round(odds.chance * 100)}% chance): ${ok ? "Success!" : "Failure."}`);
    }
    for (const o of ok ? c.success : c.failure) {
      if (o.text) lines.push(o.text);
      const d = describeOutcome(o, giftName, statusName);
      if (d) lines.push("→ " + d);
    }
    setResult(lines);
  };
  if (!teams.length) return <Notice kind="info">Make a team (Teams page) to test checks with real Sinners.</Notice>;
  return (
    <div className="stack">
      <div className="fields">
        <Select label="Team" value={teamId} onChange={setTeamId} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
        <NumberInput label="Sinner SP" value={sp} onChange={setSp} min={-45} max={45} hint="Heads chance = 50 + SP" />
      </div>
      {ev.choices.map((c) => (
        <div key={c.id} className="card">
          <strong>{c.label || "Choice"}</strong>
          {c.hasCheck ? (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Sinner</th>
                    <th>Best skill</th>
                    <th className="num">Success</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(({ sinner, m, idn }) => {
                    const odds = checkOdds(c, idn!, sp, m?.uptie ?? 4, coinTypes);
                    return (
                      <tr key={sinner}>
                        <td>{sinner}</td>
                        <td>{odds.skillName}</td>
                        <td className="num">
                          {Math.round(odds.chance * 100)}% <span className="muted small">({odds.label})</span>
                        </td>
                        <td>
                          <Button small onClick={() => run(c, sinner)}>
                            Try
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <Button small onClick={() => run(c, members[0]?.sinner ?? "")}>
                Choose this
              </Button>
            </div>
          )}
        </div>
      ))}
      {result && (
        <Notice kind="ok" onClose={() => setResult(null)}>
          {result.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </Notice>
      )}
    </div>
  );
}

export function EventEditor({ item: x, edit }: { item: GameEvent; edit: Edit<GameEvent> }) {
  return (
    <div className="stack">
      <Section id="ev-basics" title="Basics" summary={`${x.choices.length} choice${x.choices.length === 1 ? "" : "s"}`}>
        <div className="fields">
          <TextInput label="Event name" className="full" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <TextArea label="Event text" className="full" value={x.intro} onChange={(v) => edit((d) => void (d.intro = v), "intro")} rows={4} />
        </div>
      </Section>
      {x.choices.map((c, i) => (
        <ChoiceEditor key={c.id} c={c} index={i} edit={(fn, k) => edit((d) => fn(d.choices[i]), k ? `c${i}${k}` : undefined)} onRemove={() => edit((d) => void d.choices.splice(i, 1))} />
      ))}
      {x.choices.length < 8 && (
        <Button icon="plus" onClick={() => edit((d) => void d.choices.push(zEventChoice.parse({ id: newId(), label: "New choice" })))}>
          Add choice
        </Button>
      )}
      <Section id="ev-test" title="Test this event" summary="success chances per Sinner">
        <EventTester ev={x} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------
export function CoinTypeEditor({ item: x, edit }: { item: CoinType; edit: Edit<CoinType> }) {
  const ws = useWorkspace((s) => s.ws);
  const usedBy: string[] = [];
  const scan = (owner: string, skills: { name: string; coins: { customType: string | null }[] }[]) => {
    for (const s of skills) if (s.coins.some((c) => c.customType === x.key)) usedBy.push(`${owner}: ${s.name}`);
  };
  for (const i of ws.identities) scan(i.name, [...i.skills, ...i.defense]);
  for (const e of ws.egos) scan(e.name, [e.awakening, ...(e.corrosion ? [e.corrosion] : [])]);
  for (const e of ws.enemies) scan(e.name, [...e.skills, ...e.parts.flatMap((p) => p.skills)]);
  return (
    <div className="stack">
      <Section id="ct-basics" title="Basics" summary={x.clash === "normal" ? "breaks when it loses" : x.clash}>
        <div className="fields">
          <TextInput label="Coin type name" className="span-2" value={x.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          <TagInput label="Tags" className="full" value={x.tags} onChange={(v) => edit((d) => void (d.tags = v), "tags")} hint="Your own labels for searching and filtering. Spaces are fine; press Enter or comma to add." />
          <div className="field">
            <label className="label" htmlFor={`ct-color-${x.id}`}>
              Colour
            </label>
            <input id={`ct-color-${x.id}`} type="color" className="input" style={{ padding: 4 }} value={x.color} onChange={(e) => edit((d) => void (d.color = e.target.value), "color")} />
          </div>
          <TextArea label="Description" className="full" value={x.description} onChange={(v) => edit((d) => void (d.description = v), "desc")} rows={2} />
        </div>
      </Section>
      <Section id="ct-clash" title="In a Clash" summary={x.clash}>
        <div className="fields">
          <Select
            label="When it loses a Clash round"
            className="span-2"
            value={x.clash}
            onChange={(v) => edit((d) => void (d.clash = v))}
            options={[
              { value: "normal", label: "Breaks (normal coin)" },
              { value: "unbreakable", label: "Cracks, then still hits (Unbreakable)" },
              { value: "excision", label: "Cracks, and destroys enemy Unbreakable coins (Excision)" },
            ]}
          />
          {x.clash !== "normal" && (
            <NumberInput label="Coin Power when cracked" value={x.crackedPower} onChange={(n) => edit((d) => void (d.crackedPower = n))} min={0} max={99} hint="The game uses 1 (−1 for minus coins)." />
          )}
          <Check label="Ignores Paralyze" checked={x.ignoreParalyze} onChange={(v) => edit((d) => void (d.ignoreParalyze = v))} />
        </div>
      </Section>
      <Section id="ct-power" title="Power & flips" summary={`${x.op === "multiply" ? `×${x.mult}` : x.power === null ? "skill's Coin Power" : `Coin Power ${x.power}`}${x.fixed !== "none" ? ` · always ${x.fixed}` : ""}`}>
        <div className="fields">
          <Select label="On Heads" value={x.op} onChange={(v) => edit((d) => void (d.op = v))} options={[{ value: "add", label: "Add Coin Power" }, { value: "multiply", label: "Multiply the skill's power" }]} />
          {x.op === "multiply" ? (
            <NumberInput label="Multiplier" value={x.mult} onChange={(n) => edit((d) => void (d.mult = n), "mult")} min={0} max={10} step={0.25} decimals={2} />
          ) : (
            <>
              <Check label="Own Coin Power" checked={x.power !== null} onChange={(on) => edit((d) => void (d.power = on ? 4 : null))} hint={x.power === null ? "Uses the Coin Power of the skill it's on." : undefined} />
              {x.power !== null && <NumberInput label="Coin Power" value={x.power} onChange={(n) => edit((d) => void (d.power = n), "power")} min={-99} max={99} />}
            </>
          )}
          <NumberInput label="Heads chance bonus (%)" value={x.headsBonus} onChange={(n) => edit((d) => void (d.headsBonus = n), "hb")} min={-100} max={100} />
          <Select label="Result" value={x.fixed} onChange={(v) => edit((d) => void (d.fixed = v))} options={[{ value: "none", label: "Random (50 + SP)" }, { value: "heads", label: "Always Heads" }, { value: "tails", label: "Always Tails" }]} />
          <Select label="Damage type" value={x.dmgType ?? ""} onChange={(v) => edit((d) => void (d.dmgType = (v || null) as CoinType["dmgType"]))} options={[{ value: "", label: "Same as the skill" }, ...DMG_TYPES.map((t) => ({ value: t, label: DMG_LABEL[t] }))]} />
          <Select label="Sin affinity" value={x.sin ?? ""} onChange={(v) => edit((d) => void (d.sin = (v || null) as CoinType["sin"]))} options={[{ value: "", label: "Same as the skill" }, ...SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }))]} />
        </div>
        <p className="small muted">A coin can still override any of these for itself (Customize on the coin).</p>
      </Section>
      <Section id="ct-rules" title="Rules every coin of this type has" summary={`${x.effects.length} rule${x.effects.length === 1 ? "" : "s"}`}>
        <RulesEditor scope="coin" effects={x.effects} edit={(fn, k) => edit((d) => fn(d.effects), k)} emptyText="No rules. Add e.g. '[On Hit] Inflict 1 Burn' and every coin of this type will do it." />
      </Section>
      <Section id="ct-used" title="Used by" summary={`${usedBy.length} skill${usedBy.length === 1 ? "" : "s"}`} defaultOpen={false}>
        {usedBy.length ? (
          <ul style={{ margin: 0 }}>
            {usedBy.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No skill uses this coin type yet. Pick it in a skill's coin list.</p>
        )}
      </Section>
    </div>
  );
}
