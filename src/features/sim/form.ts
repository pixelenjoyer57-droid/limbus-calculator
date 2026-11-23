import type { Workspace } from "../../data/schema";
import type { SimForm } from "../../store/session";

/**
 * Repairs a remembered set-up form so it only points at things that still exist:
 * a deleted team falls back to the first team, a deleted encounter to the first one
 * (or Quick pick when there are none), and quick-pick rows for deleted custom enemies are dropped.
 * Game enemies (ids starting "g:") come from the game data, not the workspace, so they stay.
 * Returns the same object when nothing needed fixing.
 */
export function healSimForm(ws: Workspace, f: SimForm): SimForm {
  let out = f;
  const set = (patch: Partial<SimForm>) => {
    out = { ...out, ...patch };
  };
  if (!ws.teams.some((t) => t.id === f.teamId)) set({ teamId: ws.teams[0]?.id ?? "" });
  if (!ws.encounters.some((e) => e.id === f.encounterId)) {
    const first = ws.encounters[0]?.id ?? "";
    set({ encounterId: first });
    if (!first && f.source === "encounter") set({ source: "quick" });
  }
  const quick = f.quick.filter((q) => q.enemyId.startsWith("g:") || ws.enemies.some((e) => e.id === q.enemyId));
  if (quick.length !== f.quick.length) set({ quick });
  return out;
}
