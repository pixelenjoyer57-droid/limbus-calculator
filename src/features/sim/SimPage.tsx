import { useEffect, useRef, useState, type ReactNode } from "react";
import { SIN_COLOR, SIN_LABEL, SINS } from "../../engine/constants";
import type { BattleState, PlannedAction, UnitState } from "../../engine/types";
import { createBattle } from "../../engine/setup";
import { autoPlan, egoOptions, forecast, resolveTurn, runToEnd, skillOptions } from "../../engine/turn";
import type { BatchResult } from "../../engine/batch";
import { overclockCost } from "../../engine/formulas";
import { core } from "../../engine/state";
import { useWorkspace } from "../../store/workspace";
import { useSession, type SimForm } from "../../store/session";
import { toast } from "../../store/toast";
import { runBatchAsync } from "../../lib/worker";
import { engineWorkspace } from "../../gamedata";
import { ContentPicker } from "../../ui/ContentPicker";
import { href, navigate } from "../../lib/router";
import { Button, Check, NumberInput, Segmented, Select } from "../../ui/controls";
import { Bar, Card, EmptyState, Notice, Stat } from "../../ui/layout";
import { useStatusName } from "../../ui/game";
import { LogView } from "./LogView";
import { Battlefield } from "./Battlefield";
import type { Workspace } from "../../data/schema";

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

function defaultForm(ws: Workspace): SimForm {
  return {
    teamId: ws.teams[0]?.id ?? "",
    source: ws.encounters.length ? "encounter" : "quick",
    encounterId: ws.encounters[0]?.id ?? "",
    quick: ws.enemies[0] ? [{ enemyId: ws.enemies[0].id, level: 0, count: 1 }] : [],
    skillMode: "free",
    runs: 200,
    maxTurns: 40,
    useEgo: true,
  };
}

/** Builds the engine set-up; loads the game data first so teams/encounters/quick lists that use game items work. */
async function setupFor(ws: Workspace, f: SimForm) {
  const team = ws.teams.find((t) => t.id === f.teamId);
  if (!team) return null;
  const refs = f.source === "quick" ? f.quick.map((q) => q.enemyId) : [];
  return {
    workspace: await engineWorkspace(ws, refs),
    team,
    encounterId: f.source === "encounter" ? f.encounterId : null,
    enemies: f.source === "quick" ? f.quick : undefined,
    settings: { skillMode: f.skillMode },
  };
}

// ---------------------------------------------------------------------------------
function UnitCard({ b, u }: { b: BattleState; u: UnitState }) {
  const statusName = useStatusName();
  const body = core(b, u);
  const st = Math.max(u.stagger, body.stagger);
  return (
    <div className={`unit ${u.alive ? "" : "dead"}`}>
      <div className="row">
        <span className="uname" style={{ flex: 1 }}>
          {u.name}
        </span>
        {!u.alive && <span className="badge red">Defeated</span>}
        {st > 0 && <span className="badge warn">{["", "Staggered", "Stagger+", "Stagger++"][st]}</span>}
        {u.panic !== "none" && <span className="badge warn">{u.panic === "panic" ? "Panic" : "Low Morale"}</span>}
      </div>
      <div className="ustat">
        <span>HP</span>
        <Bar value={Math.max(0, u.kind === "part" ? u.hp : body.hp)} max={u.kind === "part" ? u.maxHp : body.maxHp} kind="hp" />
        <span className="mono">
          {Math.max(0, u.kind === "part" ? u.hp : body.hp)}/{u.kind === "part" ? u.maxHp : body.maxHp}
        </span>
        {u.kind === "part" && (
          <>
            <span>Core</span>
            <Bar value={Math.max(0, body.hp)} max={body.maxHp} kind="hp" />
            <span className="mono">{Math.max(0, body.hp)}</span>
          </>
        )}
        {u.hasSanity && (
          <>
            <span>SP</span>
            <Bar value={u.sp + 45} max={90} kind="sp" />
            <span className="mono">{u.sp}</span>
          </>
        )}
        {body.shield > 0 && (
          <>
            <span>Shield</span>
            <span />
            <span className="mono">{body.shield}</span>
          </>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        Speed {u.speed} · {u.slots} slot{u.slots === 1 ? "" : "s"}
        {body.thresholds.filter((t) => !t.triggered).length > 0 && ` · next Stagger at ${Math.max(...body.thresholds.filter((t) => !t.triggered).map((t) => t.hp))} HP`}
      </div>
      {u.statuses.length > 0 && (
        <div className="parts" style={{ marginTop: 6 }}>
          {u.statuses.map((s) => (
            <span key={s.key} className="part">
              {statusName(s.key)} {s.potency ? `${s.potency}/${s.count}` : s.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Skill + target pickers and the Clash forecast for one planned ally action. Shared by the list and the board dialog. */
function ActionControls({ b, a, onChange, header }: { b: BattleState; a: PlannedAction; onChange: (patch: Partial<PlannedAction>) => void; header?: ReactNode }) {
  const opts = skillOptions(b, a);
  const egos = egoOptions(b, a);
  const skill = a.skill ? b.content.skills[a.skill] : undefined;
  const fc = forecast(b, a);
  const enemyActions = b.plan.filter((e) => e.side === "enemy" && e.skill && b.units.find((x) => x.uid === e.uid)?.alive);
  const enemies = b.units.filter((e) => e.side === "enemy" && e.alive && e.targetable);
  const value = a.ego ? `ego:${a.ego.key}:${a.ego.overclock ? "oc" : "aw"}` : a.skill ?? "";
  const targetValue = a.targetAction ? `act:${a.targetAction}` : a.target ? `unit:${a.target}` : "";
  return (
    <div>
      <div className="row">
        {header}
        <span className="spacer" />
        {fc.mode === "clash" && <span className={`badge ${fc.win! >= 0.6 ? "green" : fc.win! < 0.4 ? "red" : "gold"}`}>Clash · {pct(fc.win!)} win</span>}
        {fc.mode === "oneSided" && <span className="badge">One-sided</span>}
        {fc.mode === "defense" && <span className="badge">{fc.note}</span>}
      </div>
      <div className="fields" style={{ marginTop: 8 }}>
        <Select
          label="Skill"
          className="span-2"
          value={value}
          onChange={(v) => {
            if (v.startsWith("ego:")) {
              const [, key, mode] = v.split(":");
              const ego = b.content.egos[key];
              onChange({ ego: { key, overclock: mode === "oc" }, skill: mode === "oc" && ego.corrosion ? ego.corrosion : ego.awakening });
            } else onChange({ skill: v || null, ego: null });
          }}
          options={[
            { value: "", label: "— do nothing —" },
            ...opts.map((k) => {
              const s = b.content.skills[k];
              return { value: k, label: `${s.name} · ${s.sin ? SIN_LABEL[s.sin] : "—"} · ${s.basePower}${s.coinPower >= 0 ? "+" : ""}${s.coinPower}×${s.coins.length}`, group: s.kind === "attack" ? "Skills" : "Defense" };
            }),
            ...egos.flatMap((e) => {
              const ego = b.content.egos[e.key];
              const cost = SINS.filter((s) => ego.cost[s]).map((s) => `${SIN_LABEL[s]} ${ego.cost[s]}`).join(", ");
              const list = [{ value: `ego:${e.key}:aw`, label: `${ego.name} (${ego.grade}) · ${cost || "free"} · ${ego.spCost} SP${e.affordable ? "" : " — not enough resources"}`, group: "E.G.O", disabled: !e.affordable || e.usedThisTurn }];
              if (ego.corrosion) list.push({ value: `ego:${e.key}:oc`, label: `${ego.name} Overclock · ×1.5 cost · ${overclockCost(ego.spCost)} SP`, group: "E.G.O", disabled: !e.overclockAffordable || e.usedThisTurn });
              return list;
            }),
          ]}
        />
        {skill && skill.kind === "attack" && (
          <Select
            label="Target"
            className="span-2"
            value={targetValue}
            onChange={(v) => {
              if (v.startsWith("act:")) {
                const id = v.slice(4);
                const e = b.plan.find((x) => x.id === id);
                onChange({ targetAction: id, target: e?.uid ?? null });
              } else onChange({ target: v.slice(5) || null, targetAction: null });
            }}
            options={[
              ...enemyActions.map((e) => {
                const eu = b.units.find((x) => x.uid === e.uid)!;
                const es = b.content.skills[e.skill!];
                const tgt = b.units.find((x) => x.uid === e.target);
                return { value: `act:${e.id}`, label: `${eu.name}: ${es.name} (Speed ${eu.speed})${tgt ? ` → ${tgt.name}` : ""}`, group: "Clash with / hit an enemy skill" };
              }),
              ...enemies.map((e) => ({ value: `unit:${e.uid}`, label: `${e.name} (no Clash)`, group: "Just attack" })),
            ]}
          />
        )}
      </div>
      {fc.note && fc.mode === "oneSided" && <p className="small muted" style={{ margin: "6px 0 0" }}>{fc.note}</p>}
    </div>
  );
}

function ActionRow({ b, a, onChange }: { b: BattleState; a: PlannedAction; onChange: (patch: Partial<PlannedAction>) => void }) {
  const u = b.units.find((x) => x.uid === a.uid)!;
  const skill = a.skill ? b.content.skills[a.skill] : undefined;
  return (
    <div className="action" style={{ ["--sin" as string]: skill?.sin ? SIN_COLOR[skill.sin] : "var(--line)" }}>
      <ActionControls
        b={b}
        a={a}
        onChange={onChange}
        header={
          <>
            <strong>{u.name}</strong>
            <span className="muted small">
              Slot {a.slot + 1} · Speed {u.speed}
            </span>
          </>
        }
      />
    </div>
  );
}

function EnemyIntentLine({ b, a }: { b: BattleState; a: PlannedAction }) {
  const u = b.units.find((x) => x.uid === a.uid)!;
  const s = b.content.skills[a.skill!];
  const t = b.units.find((x) => x.uid === a.target);
  return (
    <>
      <strong>{u.name}</strong> (Speed {u.speed}): {s.name} <span className="muted">({s.sin ? SIN_LABEL[s.sin] : "—"} {s.kind === "attack" ? s.dmgType.toLowerCase() : s.kind}, {s.basePower}{s.coinPower >= 0 ? "+" : ""}{s.coinPower}×{s.coins.length})</span>
      {t ? ` → ${t.name}` : ""}
    </>
  );
}

function EnemyIntents({ b }: { b: BattleState }) {
  const acts = b.plan.filter((a) => a.side === "enemy" && a.skill);
  if (!acts.length) return <p className="muted small">Enemies do nothing this turn.</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: "1.1em" }}>
      {acts.map((a) => (
        <li key={a.id}>
          <EnemyIntentLine b={b} a={a} />
        </li>
      ))}
    </ul>
  );
}

function BattleView({ b, setBattle, onNew, onRestart }: { b: BattleState; setBattle: (b: BattleState) => void; onNew: () => void; onRestart: () => void }) {
  const history = useRef<BattleState[]>([]);
  const mutate = (fn: (x: BattleState) => void, remember = false) => {
    const copy = structuredClone(b);
    if (remember) history.current = [...history.current.slice(-20), structuredClone(b)];
    fn(copy);
    setBattle(copy);
  };
  const allies = b.units.filter((u) => u.side === "ally" && u.deployOrder >= 0);
  const enemies = b.units.filter((u) => u.side === "enemy" && u.kind !== "core");
  const cores = b.units.filter((u) => u.kind === "core");
  const allyActions = b.plan.filter((a) => a.side === "ally").sort((x, y) => (b.units.find((u) => u.uid === y.uid)?.speed ?? 0) - (b.units.find((u) => u.uid === x.uid)?.speed ?? 0));
  const res = b.resources.ally;
  const [view, setViewState] = useState<"board" | "list">(() => {
    try {
      return localStorage.getItem("sim-view") === "list" ? "list" : "board";
    } catch {
      return "board";
    }
  });
  const setView = (v: "board" | "list") => {
    setViewState(v);
    try {
      localStorage.setItem("sim-view", v);
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  };
  const patchAction = (id: string) => (patch: Partial<PlannedAction>) => mutate((x) => Object.assign(x.plan.find((p) => p.id === id)!, patch));
  return (
    <div className="stack">
      <Card>
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>
            {b.outcome ? (b.outcome === "win" ? "Victory" : "Defeat") : `Turn ${b.turn}`}
          </h2>
          {!b.outcome && (
            <>
              <Button icon="dice" onClick={() => mutate((x) => autoPlan(x, { onlyEmpty: false, useEgo: false }))}>
                Auto-pick skills
              </Button>
              <Button variant="primary" icon="play" onClick={() => mutate((x) => resolveTurn(x), true)}>
                Fight this turn
              </Button>
              <Button icon="bolt" onClick={() => mutate((x) => runToEnd(x, 60), true)}>
                Auto-play to the end
              </Button>
            </>
          )}
          <Button icon="undo" disabled={!history.current.length} onClick={() => { const prev = history.current.pop(); if (prev) setBattle(prev); }} label="Go back one step">
            Back
          </Button>
          <Button icon="redo" onClick={onRestart} label="Restart this fight with the same luck">
            Restart
          </Button>
          <Button icon="plus" variant="ghost" onClick={onNew}>
            New fight
          </Button>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          E.G.O resources: {SINS.filter((s) => res[s]).map((s) => `${SIN_LABEL[s]} ${res[s]}`).join(" · ") || "none yet"}. This fight uses a snapshot of your content from when it started — restart to include later edits.
        </p>
      </Card>

      <Segmented label="View" value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />

      {view === "board" ? (
        <Card title="Battlefield">
          <Battlefield
            b={b}
            renderUnit={(u) => <UnitCard b={b} u={u} />}
            renderAlly={(a) => <ActionControls b={b} a={a} onChange={patchAction(a.id)} />}
            renderEnemy={(a) =>
              a.skill ? (
                <p style={{ margin: 0 }}>
                  <EnemyIntentLine b={b} a={a} />
                </p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>This enemy does nothing this turn.</p>
              )
            }
          />
          {!b.outcome && <p className="small muted" style={{ marginTop: 8 }}>Tap a slot (the small boxes above each token) to change what it does. Tap a token for details. A skill Clashes with an enemy skill aimed at it, or with one you are faster than.</p>}
        </Card>
      ) : (
      <div className="grid two">
        <Card title="Your team">
          <div className="units">
            {allies.map((u) => (
              <UnitCard key={u.uid} b={b} u={u} />
            ))}
          </div>
        </Card>
        <Card title="Enemies">
          <div className="units">
            {[...cores.filter((c) => c.alive), ...enemies].map((u) => (
              <UnitCard key={u.uid} b={b} u={u} />
            ))}
          </div>
        </Card>
      </div>
      )}

      {!b.outcome && view === "list" && (
        <div className="grid two" style={{ alignItems: "start" }}>
          <Card title="Your plan for this turn">
            {allyActions.length ? (
              allyActions.map((a) => <ActionRow key={a.id} b={b} a={a} onChange={patchAction(a.id)} />)
            ) : (
              <p className="muted">No one can act this turn.</p>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>
              A skill Clashes with an enemy skill aimed at it, or with one you are faster than. Otherwise both attacks happen one-sided.
            </p>
          </Card>
          <Card title="What enemies will do">
            <EnemyIntents b={b} />
          </Card>
        </div>
      )}

      <Card title="Battle log">
        <LogView log={b.log} collapseOld />
      </Card>
    </div>
  );
}

function BatchView({ r }: { r: BatchResult }) {
  const peak = Math.max(1, ...r.turnHistogram.map((t) => t.wins + t.losses));
  return (
    <Card title={`Results of ${r.runs} fights`}>
      {r.warnings.map((w) => (
        <Notice key={w} kind="warn">
          {w}
        </Notice>
      ))}
      <div className="stats">
        <Stat label="Win rate" value={pct(r.wins / r.runs)} sub={`${r.wins} of ${r.runs}`} />
        <Stat label="Average turns (wins)" value={r.avgTurnsWin ? r.avgTurnsWin.toFixed(1) : "—"} />
        <Stat label="Average turns (all)" value={r.avgTurns.toFixed(1)} />
      </div>
      <h3 style={{ marginTop: 14 }}>Fight length</h3>
      <div className="hist" role="img" aria-label="Number of fights ending on each turn">
        {r.turnHistogram.map((t) => (
          <span key={t.turn} title={`Turn ${t.turn}: ${t.wins} wins, ${t.losses} losses`} style={{ height: `${((t.wins + t.losses) / peak) * 100}%`, background: t.wins >= t.losses ? "var(--green)" : "var(--red-2)" }} />
        ))}
      </div>
      <p className="small muted">Each bar is a turn number (green: mostly wins, red: mostly losses).</p>
      <h3 style={{ marginTop: 14 }}>Per unit (averages)</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Unit</th>
              <th className="num">Damage dealt</th>
              <th className="num">… from statuses</th>
              <th className="num">Damage taken</th>
              <th className="num">Clash win rate</th>
              <th className="num">Survived</th>
            </tr>
          </thead>
          <tbody>
            {r.units.map((u, i) => (
              <tr key={i}>
                <td>
                  <span className={`badge ${u.side === "ally" ? "gold" : "red"}`}>{u.side === "ally" ? "Ally" : "Enemy"}</span> {u.name}
                </td>
                <td className="num">{u.avgDamageDealt.toFixed(1)}</td>
                <td className="num">{u.avgStatusDamage.toFixed(1)}</td>
                <td className="num">{u.avgDamageTaken.toFixed(1)}</td>
                <td className="num">{pct(u.avgClashWinRate)}</td>
                <td className="num">{pct(u.survival)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Allies are played by the auto-planner: it Clashes the enemy aimed at each Sinner with the skill that has the best win chance, and uses E.G.O when it can afford it without dropping below 0 SP.</p>
    </Card>
  );
}

export default function SimPage() {
  const ws = useWorkspace((s) => s.ws);
  const saved = useSession((s) => s.sim);
  const battle = useSession((s) => s.battle);
  const setSession = useSession((s) => s.set);
  const [form, setForm] = useState<SimForm>(() => saved ?? defaultForm(ws));
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const enc = q.get("encounter"), team = q.get("team");
    if (enc || team) {
      setForm((f) => ({ ...f, ...(enc ? { encounterId: enc, source: "encounter" as const } : {}), ...(team ? { teamId: team } : {}) }));
      window.history.replaceState(null, "", "#/sim");
    }
  }, []);
  useEffect(() => setSession({ sim: form }), [form]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBattle = (b: BattleState | null) => setSession({ battle: b });

  const start = async (seed?: number) => {
    try {
      const setup = await setupFor(ws, form);
      if (!setup) {
        toast("Pick a team first.", "error");
        return;
      }
      const { battle: b, warnings } = createBattle({ ...setup, seed });
      for (const w of warnings) toast(w, "info");
      setBattle(b);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start the fight.", "error");
    }
  };

  const runMany = async () => {
    setProgress(0);
    setBatch(null);
    try {
      const setup = await setupFor(ws, form);
      if (!setup) {
        toast("Pick a team first.", "error");
        return;
      }
      const r = await runBatchAsync(setup, { runs: form.runs, maxTurns: form.maxTurns, useEgo: form.useEgo, seed: 777 }, setProgress);
      setBatch(r);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Simulation failed.", "error");
    } finally {
      setProgress(null);
    }
  };

  if (battle) return <BattleView b={battle} setBattle={setBattle} onNew={() => setBattle(null)} onRestart={() => void start(battle.seed)} />;

  const team = ws.teams.find((t) => t.id === form.teamId);
  return (
    <div className="stack">
      {!ws.teams.length && (
        <EmptyState title="You need a team first" action={<Button variant="primary" onClick={() => navigate("/team")}>Make a team</Button>}>
          Teams pick the Identities, E.G.O and gifts that go into battle.
        </EmptyState>
      )}
      {ws.teams.length > 0 && (
        <Card title="Set up a fight">
          <div className="fields wide">
            <Select label="Team" value={form.teamId} onChange={(v) => setForm({ ...form, teamId: v })} options={ws.teams.map((t) => ({ value: t.id, label: `${t.name} (${t.deploy.length} deployed)` }))} hint={team ? <a href={href(`/team/${team.id}`)}>Edit this team</a> : undefined} />
            <Segmented label="Enemies from" value={form.source} onChange={(v) => setForm({ ...form, source: v })} options={[{ value: "encounter", label: "An encounter" }, { value: "quick", label: "Quick pick" }]} />
            {form.source === "encounter" ? (
              <Select label="Encounter" value={form.encounterId} placeholder={ws.encounters.length ? undefined : "— make an encounter first —"} onChange={(v) => setForm({ ...form, encounterId: v })} options={ws.encounters.map((e) => ({ value: e.id, label: e.name }))} />
            ) : null}
            <Segmented label="Skills each turn" value={form.skillMode} onChange={(v) => setForm({ ...form, skillMode: v })} options={[{ value: "free", label: "Pick any skill" }, { value: "deck", label: "Draw like the game (3/2/1)" }]} />
          </div>
          {form.source === "quick" && (
            <div style={{ marginTop: 10 }}>
              {form.quick.map((q, i) => (
                <div className="row" key={i} style={{ alignItems: "flex-end", marginBottom: 6 }}>
                  <div style={{ flex: 2, minWidth: 180 }}>
                    <ContentPicker kind="enemy" label="Enemy" value={q.enemyId || null} onChange={(v) => v && setForm({ ...form, quick: form.quick.map((x, j) => (j === i ? { ...x, enemyId: v } : x)) })} />
                  </div>
                  <div style={{ width: 130 }}>
                    <NumberInput label="How many" value={q.count} onChange={(n) => setForm({ ...form, quick: form.quick.map((x, j) => (j === i ? { ...x, count: n } : x)) })} min={1} max={10} />
                  </div>
                  <div style={{ width: 150 }}>
                    <NumberInput label="Level (0 = own)" value={q.level} onChange={(n) => setForm({ ...form, quick: form.quick.map((x, j) => (j === i ? { ...x, level: n } : x)) })} min={0} max={999} />
                  </div>
                  <Button icon="trash" small variant="ghost" label="Remove" onClick={() => setForm({ ...form, quick: form.quick.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <div style={{ maxWidth: 360 }}>
                <ContentPicker kind="enemy" label="Add an enemy" value={null} onChange={(v) => v && setForm({ ...form, quick: [...form.quick, { enemyId: v, level: 0, count: 1 }] })} />
              </div>
            </div>
          )}
          <div className="divider" />
          <div className="grid two">
            <div>
              <h3>Play it turn by turn</h3>
              <p className="small muted">You choose skills and targets each turn, see every coin flip and the damage math.</p>
              <Button variant="primary" icon="play" onClick={() => void start()}>
                Start the fight
              </Button>
            </div>
            <div>
              <h3>Run it many times</h3>
              <div className="fields">
                <NumberInput label="Fights" value={form.runs} onChange={(n) => setForm({ ...form, runs: n })} min={1} max={2000} step={50} />
                <NumberInput label="Give up after turn" value={form.maxTurns} onChange={(n) => setForm({ ...form, maxTurns: n })} min={1} max={99} />
                <Check label="Use E.G.O" checked={form.useEgo} onChange={(v) => setForm({ ...form, useEgo: v })} />
              </div>
              <Button icon="bolt" onClick={runMany} disabled={progress !== null}>
                {progress !== null ? `Running… ${Math.round(progress * 100)}%` : `Run ${form.runs} fights`}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {batch && <BatchView r={batch} />}
    </div>
  );
}
