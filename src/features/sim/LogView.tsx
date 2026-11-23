import { useMemo, useState } from "react";
import type { LogEntry } from "../../engine/types";
import { Segmented } from "../../ui/controls";

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
                {e.details && e.details.length ? (
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
