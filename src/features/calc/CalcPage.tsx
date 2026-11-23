import { useEffect, useMemo, useRef, useState } from "react";
import { EGO_GRADES, type EgoGrade } from "../../engine/constants";
import type { CalcResult, Combatant } from "../../engine/calc";
import type { HitRecord } from "../../engine/combat";
import { BUILTIN_STATUSES } from "../../engine/statuses";
import { useWorkspace } from "../../store/workspace";
import { useSession, type CalcForm } from "../../store/session";
import { runCalcAsync } from "../../lib/worker";
import { Button, Check, NumberInput, Segmented, Select } from "../../ui/controls";
import { Card, Notice, Stat, Tabs } from "../../ui/layout";
import { StatusSelect, useStatusName } from "../../ui/game";
import { LogView } from "../sim/LogView";
import type { Workspace } from "../../data/schema";
import { skillSummary } from "../library/skills";

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const r1 = (x: number) => (Math.round(x * 10) / 10).toString();

function blank(kind: "identity" | "enemy", id: string, skill: string): Combatant {
  return { kind, id, level: 0, uptie: 4, egos: {}, sp: 0, hpPct: 100, stagger: 0, speed: kind === "identity" ? 5 : 3, statuses: [], skill, part: 0, resonance: 0 };
}

function defaultForm(ws: Workspace): CalcForm {
  const idn = ws.identities[0];
  const en = ws.enemies.find((e) => e.skills.length) ?? ws.enemies[0];
  return {
    attacker: idn ? blank("identity", idn.id, "S1") : blank("enemy", ws.enemies[0]?.id ?? "", "K0"),
    defender: en ? blank("enemy", en.id, en.skills.length ? "K0" : "") : blank("identity", idn?.id ?? "", "S1"),
    exchange: en?.skills.length ? "clash" : "oneSided",
    turnEnd: false,
    runs: 5000,
    giftIds: [],
  };
}

function skillOptions(ws: Workspace, c: Combatant): { value: string; label: string; group?: string }[] {
  if (c.kind === "identity") {
    const idn = ws.identities.find((i) => i.id === c.id);
    if (!idn) return [];
    const out = idn.skills.map((s, i) => ({ value: `S${i + 1}`, label: `Skill ${i + 1}: ${s.name} (${skillSummary(s)})`, group: "Attack skills" }));
    idn.defense.forEach((s, i) => out.push({ value: `D${i}`, label: `${s.name} (${s.kind}${s.clashable ? ", clashable" : ""})`, group: "Defense" }));
    for (const e of ws.egos.filter((x) => x.sinner === idn.sinner)) {
      out.push({ value: `EGO:${e.id}:A`, label: `${e.name} (${e.grade}) Awakening`, group: "E.G.O" });
      if (e.corrosion) out.push({ value: `EGO:${e.id}:C`, label: `${e.name} (${e.grade}) Overclock / Corrosion`, group: "E.G.O" });
    }
    return out;
  }
  const en = ws.enemies.find((e) => e.id === c.id);
  if (!en) return [];
  if (en.parts.length) {
    const part = en.parts[Math.min(c.part, en.parts.length - 1)];
    return part.skills.map((s, i) => ({ value: `K${i}`, label: `${s.name} (${skillSummary(s)})` }));
  }
  return en.skills.map((s, i) => ({ value: `K${i}`, label: `${s.name} (${s.kind}, ${skillSummary(s)})` }));
}

/** UI value <-> Combatant.skill (E.G.O picks also equip the E.G.O). */
function uiSkillValue(_ws: Workspace, c: Combatant): string {
  if (!c.skill.startsWith("E:")) return c.skill;
  const [, grade, ac] = c.skill.split(":");
  const egoId = c.egos[grade as EgoGrade];
  return egoId ? `EGO:${egoId}:${ac}` : "";
}

function CombatantForm({ title, c, set, ws, canSkipSkill }: { title: string; c: Combatant; set: (c: Combatant) => void; ws: Workspace; canSkipSkill?: boolean }) {
  const isId = c.kind === "identity";
  const en = !isId ? ws.enemies.find((e) => e.id === c.id) : undefined;
  const opts = skillOptions(ws, c);
  const sourceOpts = isId ? ws.identities.map((i) => ({ value: i.id, label: `${i.name} (${i.sinner})` })) : ws.enemies.map((e) => ({ value: e.id, label: `${e.name} (Lv ${e.level})` }));
  const hasSanity = isId || en?.hasSanity;
  const statusName = useStatusName();
  return (
    <Card title={title}>
      <div className="fields">
        <Segmented
          label="Type"
          value={c.kind}
          onChange={(k) => {
            const first = k === "identity" ? ws.identities[0]?.id ?? "" : ws.enemies[0]?.id ?? "";
            set(blank(k, first, k === "identity" ? "S1" : canSkipSkill ? "" : "K0"));
          }}
          options={[{ value: "identity", label: "Identity" }, { value: "enemy", label: "Enemy" }]}
        />
        <Select label={isId ? "Identity" : "Enemy"} className="span-2" value={c.id} placeholder="— pick —" onChange={(v) => set({ ...c, id: v, skill: isId ? "S1" : canSkipSkill ? "" : "K0", part: 0 })} options={sourceOpts} />
        {en && en.parts.length > 0 && (
          <Select label="Part" value={String(c.part)} onChange={(v) => set({ ...c, part: Number(v), skill: c.skill ? "K0" : "" })} options={en.parts.map((p, i) => ({ value: String(i), label: p.name }))} hint="Acts with / is hit on this part." />
        )}
        <Select
          label="Skill"
          className="span-2"
          value={uiSkillValue(ws, c)}
          placeholder={canSkipSkill ? "— no skill (just gets hit) —" : undefined}
          onChange={(v) => {
            if (v.startsWith("EGO:")) {
              const [, egoId, ac] = v.split(":");
              const ego = ws.egos.find((e) => e.id === egoId);
              if (!ego) return;
              set({ ...c, egos: { [ego.grade]: ego.id }, skill: `E:${ego.grade}:${ac}` });
            } else set({ ...c, skill: v });
          }}
          options={opts}
        />
        <NumberInput label="Level (0 = own)" value={c.level} onChange={(n) => set({ ...c, level: n })} min={0} max={999} />
        {isId && <NumberInput label="Uptie" value={c.uptie} onChange={(n) => set({ ...c, uptie: n })} min={1} max={4} />}
        {hasSanity && <NumberInput label="SP" value={c.sp} onChange={(n) => set({ ...c, sp: n })} min={-45} max={45} hint={`Heads chance ${50 + c.sp}%`} />}
        <NumberInput label="HP %" value={c.hpPct} onChange={(n) => set({ ...c, hpPct: n })} min={1} max={100} />
        <Select label="Stagger" value={String(c.stagger)} onChange={(v) => set({ ...c, stagger: Number(v) })} options={[{ value: "0", label: "Not Staggered" }, { value: "1", label: "Staggered (+100%)" }, { value: "2", label: "Stagger+ (+150%)" }, { value: "3", label: "Stagger++ (+200%)" }]} />
        <NumberInput label="Resonance level bonus" value={c.resonance} onChange={(n) => set({ ...c, resonance: n })} min={0} max={13} info="Offense/Defense Level bonus from Sin Resonance: +1 for the 2nd skill of a sin, +3 for the 3rd/4th, … or Absolute Resonance (+3 for 3, +5 for 4–5 …)." />
      </div>
      <h4 style={{ marginTop: 14 }}>Statuses on this unit</h4>
      {c.statuses.map((s, i) => {
        const pc = BUILTIN_STATUSES[s.key]?.mode === "pc" || ws.statuses.find((x) => x.key === s.key)?.mode === "pc";
        const upd = (patch: Partial<typeof s>) => set({ ...c, statuses: c.statuses.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return (
          <div className="row" key={i} style={{ alignItems: "flex-end", marginBottom: 6 }}>
            <div style={{ flex: 2, minWidth: 160 }}>
              <StatusSelect value={s.key} onChange={(v) => upd({ key: v })} />
            </div>
            {pc && (
              <div style={{ width: 130 }}>
                <NumberInput label="Potency" value={s.potency} onChange={(n) => upd({ potency: n })} min={1} max={99} />
              </div>
            )}
            <div style={{ width: 130 }}>
              <NumberInput label={pc ? "Count" : "Amount"} value={s.count} onChange={(n) => upd({ count: n })} min={1} max={99} />
            </div>
            <Button icon="trash" small variant="ghost" label={`Remove ${statusName(s.key)}`} onClick={() => set({ ...c, statuses: c.statuses.filter((_, j) => j !== i) })} />
          </div>
        );
      })}
      <Button small icon="plus" onClick={() => set({ ...c, statuses: [...c.statuses, { key: "BURN", potency: 3, count: 2 }] })}>
        Add status
      </Button>
    </Card>
  );
}

function Parts({ parts }: { parts: { label: string; value: number }[] }) {
  return (
    <span className="parts">
      {parts.map((p, i) => (
        <span key={i} className={`part ${p.value > 0 ? "pos" : p.value < 0 ? "neg" : ""}`}>
          {p.label} {p.value >= 0 ? "+" : ""}
          {Math.round(p.value * 1000) / 10}%
        </span>
      ))}
    </span>
  );
}

export function HitsTable({ hits }: { hits: HitRecord[] }) {
  if (!hits.length) return <p className="muted">No hits landed in this scenario.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Hit</th>
            <th className="num">Roll</th>
            <th>Static (resistances, level, crit, clash)</th>
            <th>Dynamic (buffs, debuffs, effects)</th>
            <th className="num">Damage</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => {
            const st = h.staticParts.reduce((a, p) => a + p.value, 0);
            const dy = h.dynamicParts.reduce((a, p) => a + p.value, 0);
            return (
              <tr key={i}>
                <td>
                  <strong>{h.attacker}</strong> → {h.target}
                  <div className="small muted">
                    {h.skill} · coin {h.coin} · {h.evaded ? "Evaded" : h.heads ? "Heads" : "Tails"}
                    {h.crit ? " · CRIT" : ""}
                  </div>
                </td>
                <td className="num">
                  {h.roll}
                  {h.roll !== h.rollBeforeGuard && <div className="small muted">was {h.rollBeforeGuard}</div>}
                </td>
                <td>
                  <Parts parts={h.staticParts} />
                  <div className="small muted">= {st >= 0 ? "+" : ""}{Math.round(st * 1000) / 10}% · Off {h.offLevel} vs Def {h.defLevel}</div>
                </td>
                <td>{h.dynamicParts.length ? <Parts parts={h.dynamicParts} /> : <span className="muted small">none</span>}</td>
                <td className="num">
                  <strong>{h.evaded ? "—" : h.final}</strong>
                  {!h.evaded && (
                    <div className="small muted mono">
                      {h.roll}×{(1 + st).toFixed(3)}×{(1 + dy).toFixed(3)} = {h.raw.toFixed(2)}
                    </div>
                  )}
                  {h.extra.map((e, j) => (
                    <div key={j} className="small">
                      +{e.value} {e.label}
                    </div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Histogram({ hist, max }: { hist: { value: number; prob: number }[]; max: number }) {
  const buckets = 40;
  const top = Math.max(1, max);
  const bins = new Array(buckets).fill(0);
  for (const h of hist) bins[Math.min(buckets - 1, Math.floor((h.value / (top + 1)) * buckets))] += h.prob;
  const peak = Math.max(...bins, 1e-9);
  return (
    <figure style={{ margin: 0 }}>
      <div className="hist" role="img" aria-label="Damage distribution">
        {bins.map((b, i) => (
          <span key={i} style={{ height: `${(b / peak) * 100}%` }} title={`${Math.round((i / buckets) * top)}–${Math.round(((i + 1) / buckets) * top)} damage: ${pct(b)}`} />
        ))}
      </div>
      <figcaption className="row between small muted">
        <span>0</span>
        <span>damage →</span>
        <span>{top}</span>
      </figcaption>
    </figure>
  );
}

export default function CalcPage() {
  const ws = useWorkspace((s) => s.ws);
  const saved = useSession((s) => s.calc);
  const setSession = useSession((s) => s.set);
  const [form, setForm] = useState<CalcForm>(() => saved ?? defaultForm(ws));
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState(0);
  const seq = useRef(0);

  // prefill from "Test in calculator"
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const a = q.get("attacker"), d = q.get("defender");
    if (a || d) {
      const [kind, id] = (a ?? d)!.split(":");
      const c = blank(kind as "identity" | "enemy", id, kind === "identity" ? "S1" : a ? "K0" : "");
      setForm((f) => (a ? { ...f, attacker: c } : { ...f, defender: c, exchange: "oneSided" }));
      window.history.replaceState(null, "", "#/calc");
    }
  }, []);

  useEffect(() => {
    setSession({ calc: form });
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await runCalcAsync({
          workspace: ws,
          attacker: form.attacker,
          defender: form.defender,
          exchange: form.exchange,
          turnEnd: form.turnEnd,
          runs: form.runs,
          seed: 12345,
          gifts: form.giftIds.map((g) => ({ giftId: g, level: 0 })),
          assumePassives: form.assumePassives ?? true,
        });
        if (my === seq.current) setResult(r);
      } catch (e) {
        if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, ws]);

  const sc = result?.scenarios[Math.min(scenario, (result?.scenarios.length ?? 1) - 1)];
  const isClash = form.exchange === "clash";
  const dmg = result?.damageToDefender;
  const enough = ws.identities.length + ws.enemies.length > 0;
  const swap = () => setForm({ ...form, attacker: form.defender.skill ? form.defender : { ...form.defender, skill: form.defender.kind === "identity" ? "S1" : "K0" }, defender: form.attacker });

  const summary = useMemo(() => {
    if (!result || !dmg) return null;
    return (
      <div className="stats">
        {isClash && <Stat label="Attacker wins the Clash" value={pct(result.attackerWin)} sub={`avg ${r1(result.avgClashRounds)} rounds`} />}
        <Stat label="Average damage dealt" value={r1(dmg.mean)} sub={`median ${dmg.p50}`} />
        <Stat label="Damage range" value={`${dmg.min}–${dmg.max}`} sub={`80% between ${dmg.p10} and ${dmg.p90}`} />
        <Stat label="Defender defeated" value={pct(result.defenderKilled)} />
        <Stat label="Defender Staggered" value={pct(result.defenderStaggered)} />
        {isClash && <Stat label="Damage taken by attacker" value={r1(result.damageToAttacker.mean)} sub={`max ${result.damageToAttacker.max}`} />}
      </div>
    );
  }, [result, dmg, isClash]);

  if (!enough) return <Notice kind="info">Build an Identity or an enemy first — the calculator uses your own content.</Notice>;

  return (
    <div className="stack">
      <p className="muted" style={{ maxWidth: 760 }}>
        One exchange between two units, run {form.runs.toLocaleString()} times with the real combat engine. The best/worst cases below show each coin with every term of the damage formula.
      </p>
      <div className="grid two">
        <CombatantForm title="Attacker" c={form.attacker} set={(c) => setForm({ ...form, attacker: c })} ws={ws} />
        <CombatantForm title="Defender" c={form.defender} set={(c) => setForm({ ...form, defender: c })} ws={ws} canSkipSkill />
      </div>
      <Card>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Segmented label="Exchange" value={form.exchange} onChange={(v) => setForm({ ...form, exchange: v })} options={[{ value: "clash", label: "Clash" }, { value: "oneSided", label: "One-sided attack" }]} />
          <Select label="Runs" value={String(form.runs)} onChange={(v) => setForm({ ...form, runs: Number(v) })} options={[{ value: "1000", label: "1,000 (fast)" }, { value: "5000", label: "5,000" }, { value: "20000", label: "20,000 (precise)" }]} />
          <Check label="Include Turn End (Burn, etc.)" checked={form.turnEnd} onChange={(v) => setForm({ ...form, turnEnd: v })} />
          <Check label="Passives: assume Res/Owned requirements are met" checked={form.assumePassives ?? true} onChange={(v) => setForm({ ...form, assumePassives: v })} />
          <Button icon="swords" onClick={swap}>
            Swap sides
          </Button>
        </div>
        {ws.gifts.length > 0 && (
          <div className="field" style={{ marginTop: 10 }}>
            <span className="label">Attacker's E.G.O Gifts</span>
            <div className="row">
              {ws.gifts.map((g) => (
                <label key={g.id} className="check" style={{ minHeight: 36 }}>
                  <input type="checkbox" checked={form.giftIds.includes(g.id)} onChange={(e) => setForm({ ...form, giftIds: e.target.checked ? [...form.giftIds, g.id] : form.giftIds.filter((x) => x !== g.id) })} />
                  {g.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {form.exchange === "clash" && !form.defender.skill && <p className="small" style={{ color: "var(--warn)" }}>Pick a skill for the defender to Clash with.</p>}
      </Card>

      <section aria-live="polite" aria-busy={busy}>
        <Card title={busy ? "Results (calculating…)" : "Results"}>
          {error && <Notice kind="error">{error}</Notice>}
          {result?.warnings.map((w) => (
            <Notice key={w} kind="warn">
              {w}
            </Notice>
          ))}
          {summary}
          {dmg && dmg.max > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3>How often each damage total happens</h3>
              <Histogram hist={dmg.hist} max={dmg.max} />
            </div>
          )}
        </Card>
      </section>

      {result && result.scenarios.length > 0 && (
        <Card title="Step by step">
          <Tabs label="Scenario" value={String(scenario)} onChange={(v) => setScenario(Number(v))} tabs={result.scenarios.map((s, i) => ({ value: String(i), label: s.name }))} />
          {sc && (
            <>
              <p className="muted">{sc.description}</p>
              <div className="stats" style={{ marginBottom: 12 }}>
                <Stat label="Damage to defender" value={sc.defenderDamage} />
                {isClash && <Stat label="Clash winner" value={sc.winner === "attacker" ? "Attacker" : sc.winner === "defender" ? "Defender" : "—"} />}
                {isClash && <Stat label="Damage to attacker" value={sc.attackerDamage} />}
              </div>
              <HitsTable hits={sc.hits} />
              <details style={{ marginTop: 12 }}>
                <summary>Full log of this scenario</summary>
                <LogView log={sc.log} />
              </details>
            </>
          )}
          <details style={{ marginTop: 12 }}>
            <summary>A random example run</summary>
            <LogView log={result.sample} />
          </details>
        </Card>
      )}
    </div>
  );
}

export const _grades = EGO_GRADES;
