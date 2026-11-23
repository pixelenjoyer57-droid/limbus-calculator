import { useState, type ReactNode } from "react";
import { SIN_COLOR, type Sinner } from "../../engine/constants";
import type { BattleState, PlannedAction, UnitState } from "../../engine/types";
import { core } from "../../engine/state";
import { Bar, Dialog } from "../../ui/layout";
import { useStatusName } from "../../ui/game";
import "./battlefield.css";

const SINNER_CODE: Record<Sinner, string> = {
  "Yi Sang": "YS", Faust: "FA", "Don Quixote": "DQ", "Ryōshū": "RY", Meursault: "ME", "Hong Lu": "HL",
  Heathcliff: "HE", Ishmael: "IS", Rodion: "RO", Sinclair: "SI", Outis: "OU", Gregor: "GR",
};

function initials(name: string): string {
  const words = name.split(/[\s\-–—_]+/).filter(Boolean);
  if (!words.length) return "?";
  const s = words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((w) => w[0]).join("");
  return s.toLocaleUpperCase();
}
const partName = (u: UnitState) => (u.kind === "part" && u.name.includes(" — ") ? u.name.split(" — ").slice(1).join(" — ") : u.name);
export const monogram = (u: UnitState) => (u.sinner && SINNER_CODE[u.sinner] ? SINNER_CODE[u.sinner] : initials(u.kind === "part" ? partName(u) : u.name));
const STAGGER = ["", "Staggered", "Stagger+", "Stagger++"];

function skillChip(b: BattleState, a: PlannedAction): { text: string; sin: string | null } {
  const s = a.skill ? b.content.skills[a.skill] : undefined;
  if (!s) return { text: "Idle", sin: null };
  const sin = s.sin ? SIN_COLOR[s.sin] : null;
  if (a.ego) return { text: `E.G.O ${s.name}`, sin };
  if (a.side === "enemy" || s.slot === "ENEMY") return { text: s.name, sin };
  return { text: `${s.slot} ${s.name}`, sin };
}

function targetText(b: BattleState, a: PlannedAction, many: boolean): string | null {
  if (!a.skill) return null;
  const pre = many ? `${a.slot + 1}: ` : "";
  if (a.targetAction) {
    const o = b.plan.find((x) => x.id === a.targetAction);
    const ou = o && b.units.find((x) => x.uid === o.uid);
    const os = o?.skill ? b.content.skills[o.skill] : undefined;
    if (ou) return `${pre}⚔ clashes ${ou.name}'s ${os?.name ?? "action"}`;
  }
  const t = b.units.find((x) => x.uid === a.target);
  return t ? `${pre}→ ${t.name}` : null;
}

function targetUidOf(b: BattleState, a: PlannedAction | undefined): string | null {
  if (!a) return null;
  if (a.targetAction) {
    const o = b.plan.find((x) => x.id === a.targetAction);
    if (o) return o.uid;
  }
  return a.target;
}

function Token({ b, u, isTarget, onOpen, actions, onSlot, openId, onActive }: {
  b: BattleState; u: UnitState; isTarget: boolean; onOpen: () => void; actions: PlannedAction[]; onSlot: (a: PlannedAction) => void; openId: string | null; onActive: (id: string | null) => void;
}) {
  const statusName = useStatusName();
  const body = core(b, u);
  const part = u.kind === "part";
  const hp = Math.max(0, part ? u.hp : body.hp);
  const maxHp = part ? u.maxHp : body.maxHp;
  const st = Math.max(u.stagger, body.stagger);
  const sideTxt = u.side === "ally" ? "ally" : "enemy";
  const shown = u.statuses.slice(0, 4);
  const more = u.statuses.length - shown.length;
  const label = [
    `${u.name} (${sideTxt}${part ? ", part" : ""})`,
    `HP ${hp} of ${maxHp}`,
    u.hasSanity ? `SP ${u.sp}` : null,
    st > 0 ? STAGGER[st] : null,
    u.panic !== "none" ? (u.panic === "panic" ? "Panic" : "Low Morale") : null,
    !u.alive ? "Defeated" : null,
  ].filter(Boolean).join(", ");
  const many = actions.length > 1;
  return (
    <div className={`bf-unit ${u.alive ? "" : "dead"} ${isTarget ? "is-target" : ""} ${actions.length > 2 ? "wide" : ""}`}>
      {isTarget && <span className="bf-targetlabel">Target</span>}
      {actions.length > 0 && (
        <div className="bf-slots">
          {actions.map((a) => {
            const chip = skillChip(b, a);
            const t = targetText(b, a, false);
            const ally = a.side === "ally";
            const aria = `Slot ${a.slot + 1}, Speed ${u.speed}, ${a.skill ? chip.text : "no skill"}${t ? ` ${t.replace("→", "targeting").replace("⚔", "")}` : ""}${ally ? ". Press to change" : ". Press to see details"}`;
            return (
              <button key={a.id} type="button" className={`bf-slot ${openId === a.id ? "open" : ""}`} aria-label={aria} onClick={() => onSlot(a)} onMouseEnter={() => onActive(a.id)} onMouseLeave={() => onActive(null)} onFocus={() => onActive(a.id)} onBlur={() => onActive(null)}>
                <span className="spd">Spd {u.speed}</span>
                <span className={`bf-chip ${a.skill ? "" : "idle"}`} style={chip.sin ? { ["--sin" as string]: chip.sin } : undefined}>
                  {chip.text}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {/* always rendered with a fixed height so tokens in a row line up */}
      <div className="bf-targets">
        {actions.map((a) => {
          const t = targetText(b, a, many);
          return t ? <span key={a.id} title={t}>{t}</span> : null;
        })}
      </div>
      <button type="button" className={`bf-token ${u.side} ${part ? "part" : ""}`} aria-label={`${label}. Press for details`} onClick={onOpen}>
        <span aria-hidden="true">{monogram(u)}</span>
        <span className="side-tag" aria-hidden="true">{u.side === "ally" ? "ALLY" : "FOE"}</span>
      </button>
      <div className="bf-name">{part ? partName(u) : u.name}</div>
      <div className="bf-bar">
        <span className="num"><span>HP</span><span>{hp}/{maxHp}</span></span>
        <Bar value={hp} max={maxHp} kind="hp" />
      </div>
      {u.hasSanity && (
        <div className="bf-bar">
          <span className="num"><span>SP</span><span>{u.sp}</span></span>
          <Bar value={u.sp + 45} max={90} kind="sp" />
        </div>
      )}
      <div className="bf-badges">
        {!u.alive && <span className="badge red">Defeated</span>}
        {st > 0 && <span className="badge warn">{STAGGER[st]}</span>}
        {u.panic !== "none" && <span className="badge warn">{u.panic === "panic" ? "Panic" : "Low Morale"}</span>}
      </div>
      {u.statuses.length > 0 && (
        <div className="bf-status">
          {shown.map((s) => (
            <span key={s.key} className="part">{statusName(s.key)} {s.potency ? `${s.potency}/${s.count}` : s.count}</span>
          ))}
          {more > 0 && <span className="part">+{more} more</span>}
        </div>
      )}
    </div>
  );
}

type Open = { kind: "slot"; id: string } | { kind: "unit"; uid: string } | null;

/** The visual board. Editing UI is passed in so the list view and the board share one implementation. */
export function Battlefield({ b, renderAlly, renderEnemy, renderUnit }: {
  b: BattleState;
  renderAlly: (a: PlannedAction) => ReactNode;
  renderEnemy: (a: PlannedAction) => ReactNode;
  renderUnit: (u: UnitState) => ReactNode;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [hover, setHover] = useState<string | null>(null);
  const allies = b.units.filter((u) => u.side === "ally" && u.deployOrder >= 0);
  const foes = b.units.filter((u) => u.side === "enemy");
  const cores = foes.filter((u) => u.kind === "core" && u.alive);
  const groups: { label?: string; units: UnitState[] }[] = cores.map((c) => ({ label: c.name, units: [c, ...foes.filter((p) => p.kind === "part" && p.coreUid === c.uid)] }));
  const grouped = new Set(groups.flatMap((g) => g.units.map((u) => u.uid)));
  const loose = foes.filter((u) => !grouped.has(u.uid) && u.kind !== "core");
  if (loose.length) groups.push({ units: loose });

  const actionsOf = (u: UnitState) => b.plan.filter((a) => a.uid === u.uid).sort((x, y) => x.slot - y.slot);
  const activeId = hover ?? (open?.kind === "slot" ? open.id : null);
  const targetUid = targetUidOf(b, b.plan.find((a) => a.id === activeId));
  const openAction = open?.kind === "slot" ? b.plan.find((a) => a.id === open.id) : undefined;
  const openUnit = open?.kind === "unit" ? b.units.find((u) => u.uid === open.uid) : undefined;
  const close = () => setOpen(null);

  const tok = (u: UnitState) => (
    <Token key={u.uid} b={b} u={u} isTarget={targetUid === u.uid} actions={actionsOf(u)} openId={open?.kind === "slot" ? open.id : null}
      onOpen={() => setOpen({ kind: "unit", uid: u.uid })} onSlot={(a) => setOpen({ kind: "slot", id: a.id })} onActive={setHover} />
  );
  const ua = openAction && b.units.find((u) => u.uid === openAction.uid);
  const title = openAction && ua ? `${ua.name} — Slot ${openAction.slot + 1}` : openUnit ? openUnit.name : "";

  return (
    <>
      <div className="bf">
        <section className="bf-side ally" aria-label="Your team">
          <h3>Your team</h3>
          <div className="bf-units">{allies.map(tok)}</div>
        </section>
        <section className="bf-side enemy" aria-label="Enemies">
          <h3>Enemies</h3>
          <div className="bf-groups">
            {groups.map((g, i) => (
              <div key={g.label ?? `x${i}`} role="group" aria-label={g.label ? `${g.label} and its parts` : "Enemies"}>
                {g.label && g.units.length > 1 && <p className="bf-group-label">{g.label}</p>}
                <div className="bf-units">{g.units.map(tok)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Dialog open={!!(openAction || openUnit)} onClose={close} title={title}>
        {openAction ? (openAction.side === "ally" ? renderAlly(openAction) : renderEnemy(openAction)) : openUnit ? renderUnit(openUnit) : null}
      </Dialog>
    </>
  );
}

