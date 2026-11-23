import { useMemo, useState } from "react";
import type { LogEntry } from "../../engine/types";
import { Segmented } from "../../ui/controls";
import { SinBadge } from "../../ui/game";
import "./log.css";

type Clash = NonNullable<LogEntry["clash"]>;
type Roll = Clash["rounds"][number]["a"];
const COIN_NAME: Record<string, string> = { H: "Heads", T: "Tails", P: "Paralyzed" };
const sgn = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

function Chips({ coins }: { coins: string }) {
  return (
    <span className="coin-chips" role="img" aria-label={coins.split("").map((c) => COIN_NAME[c] ?? c).join(", ") || "No coins"}>
      {coins.split("").map((c, i) => (
        <span key={i} className={`coin-chip ${c}`} aria-hidden>
          {c}
        </span>
      ))}
    </span>
  );
}

function Math_({ who, r }: { who: string; r: Roll }) {
  const sub = r.base + r.coinAdd;
  return (
    <div>
      <b>{who}:</b> base {r.base} + coin power {r.coinAdd}
      {r.mult !== 1 ? ` (× ${Number(r.mult.toFixed(2))})` : ""} = {Math.floor(sub * r.mult + 1e-9)}
      {r.finalPower ? `, final power ${sgn(r.finalPower)}` : ""}
      {r.clashMods.map((m) => `, ${m.label} ${sgn(m.value)}`)} → Clash Power {r.total}
    </div>
  );
}

function ClashCard({ e }: { e: LogEntry }) {
  const c = e.clash!;
  const nm = (k: "a" | "b") => c[k].name;
  const roundText = (r: Clash["rounds"][number]) => {
    if (r.result === "tie") return "Tie — both toss again";
    const w = r.result;
    let t = `${nm(w)} wins the round`;
    if (r.broke) {
      const side = r.broke.side === "a" ? "a" : "b";
      t += r.broke.cracked
        ? ` — ${nm(side)}'s coin ${r.broke.coin} cracks (${r.broke.left} left)`
        : ` — ${nm(side)}'s coin ${r.broke.coin} breaks (${r.broke.left} left)`;
    }
    return t;
  };
  const outcome =
    c.outcome === "win" && c.winner ? `${nm(c.winner)} wins the Clash.` : c.outcome === "cancelled" ? "Clash count limit reached: both skills are cancelled." : "Clash interrupted: a combatant fell.";
  return (
    <details className="clash-card" open>
      <summary>{e.text}</summary>
      <div className="clash-head">
        {(["a", "b"] as const).map((k, i) => (
          <span key={k} style={{ display: "contents" }}>
            {i === 1 && <span className="clash-vs">vs</span>}
            <span className="clash-side">
              <b>
                {c[k].name} ({c[k].skill})
              </b>
              <SinBadge sin={c[k].sin} />
              {c.winner === k && <span className="clash-win">wins</span>}
            </span>
          </span>
        ))}
      </div>
      <div className="clash-scroll">
        <table className="clash-table" role="table">
          <caption>
            Clash rounds: {c.a.name} vs {c.b.name}
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Round</th>
              <th scope="col" role="columnheader">{c.a.name} coins</th>
              <th scope="col" role="columnheader">{c.a.name} power</th>
              <th scope="col" role="columnheader">{c.b.name} power</th>
              <th scope="col" role="columnheader">{c.b.name} coins</th>
              <th scope="col" role="columnheader">Result</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {c.rounds.map((r, i) => (
              <tr key={i} role="row">
                <th scope="row" role="rowheader" className="clash-rd">
                  <span aria-hidden>R</span>
                  {i + 1}
                </th>
                <td role="cell" className="clash-coins-a">
                  <Chips coins={r.a.coins} />
                </td>
                <td role="cell" className="clash-pow clash-pow-a">
                  {r.a.total}
                </td>
                <td role="cell" className="clash-pow clash-pow-b">
                  {r.b.total}
                </td>
                <td role="cell" className="clash-coins-b">
                  <Chips coins={r.b.coins} />
                </td>
                <td role="cell" className="res">
                  {roundText(r)}
                  <details>
                    <summary>Show the math</summary>
                    <div className="clash-math">
                      <Math_ who={c.a.name} r={r.a} />
                      <Math_ who={c.b.name} r={r.b} />
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="clash-final">{outcome}</div>
    </details>
  );
}

const ICON: Record<LogEntry["kind"], string> = {
  turn: "⏱",
  info: "·",
  clash: "⚔",
  attack: "➶",
  damage: "✦",
  status: "◆",
  stagger: "⚡",
  death: "✖",
  sp: "◎",
  effect: "✚",
  warn: "!",
  result: "★",
};
const KEY_KINDS: LogEntry["kind"][] = ["turn", "clash", "attack", "stagger", "death", "result", "warn"];

export function LogView({ log, initialFilter = "key", collapseOld = false }: { log: LogEntry[]; initialFilter?: "key" | "all"; collapseOld?: boolean }) {
  const [filter, setFilter] = useState<"key" | "all">(initialFilter);
  const turns = useMemo(() => {
    const map = new Map<number, LogEntry[]>();
    for (const e of log) {
      if (filter === "key" && !KEY_KINDS.includes(e.kind) && !e.important) continue;
      if (e.kind === "turn" && /^— Turn/.test(e.text)) {
        if (!map.has(e.turn)) map.set(e.turn, []);
        continue;
      }
      if (!map.has(e.turn)) map.set(e.turn, []);
      map.get(e.turn)!.push(e);
    }
    return [...map.entries()];
  }, [log, filter]);
  const lastTurn = turns.length ? turns[turns.length - 1][0] : 0;
  return (
    <div className="log">
      <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "key", label: "Key events" }, { value: "all", label: "Everything (with math)" }]} />
      {turns.map(([turn, entries]) => {
        const body = (
          <div>
            {entries.map((e, i) => (
              <div key={i} className={`log-line ${e.important ? "important" : ""} ${e.side ?? ""}`}>
                <span className="ico" aria-hidden>
                  {ICON[e.kind]}
                </span>
                {e.clash ? (
                  <ClashCard e={e} />
                ) : e.details && e.details.length ? (
                  <details>
                    <summary>{e.text}</summary>
                    <div className="formula">
                      {e.details.map((d, j) => (
                        <div key={j}>{d}</div>
                      ))}
                    </div>
                  </details>
                ) : (
                  <span>{e.text}</span>
                )}
              </div>
            ))}
            {!entries.length && <div className="muted small">Nothing notable.</div>}
          </div>
        );
        if (collapseOld && turn !== lastTurn)
          return (
            <details key={turn}>
              <summary className="log-turn">{turn === 0 ? "Setup" : `Turn ${turn}`}</summary>
              {body}
            </details>
          );
        return (
          <div key={turn}>
            <div className="log-turn">{turn === 0 ? "Setup" : `Turn ${turn}`}</div>
            {body}
          </div>
        );
      })}
    </div>
  );
}
