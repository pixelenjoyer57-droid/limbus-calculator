// "Where was I?" state: last screen, recent items, open sections, calculator
// inputs and a running simulation. Saved per workspace, so switching tabs,
// devices sleeping or closing the browser never loses progress.
import { create } from "zustand";
import type { ContentKind } from "../data/schema";
import type { BattleState } from "../engine/types";
import type { Combatant } from "../engine/calc";
import { readJSON, writeJSON } from "./storage";

export interface CalcForm {
  attacker: Combatant;
  defender: Combatant;
  exchange: "clash" | "oneSided";
  turnEnd: boolean;
  runs: number;
  giftIds: string[];
  assumePassives?: boolean;
}

export interface SimForm {
  teamId: string;
  source: "encounter" | "quick";
  encounterId: string;
  quick: { enemyId: string; level: number; count: number; slots?: number }[];
  skillMode: "free" | "deck";
  runs: number;
  maxTurns: number;
  useEgo: boolean;
}

export interface SessionState {
  wsId: string;
  route: string;
  recent: { kind: ContentKind; id: string; at: number }[];
  open: Record<string, boolean>;
  calc: CalcForm | null;
  sim: SimForm | null;
  battle: BattleState | null;
  dismissed: Record<string, boolean>;
  load: (wsId: string) => void;
  set: (patch: Partial<Omit<SessionState, "load" | "set" | "touch" | "toggle">>) => void;
  touch: (kind: ContentKind, id: string) => void;
  toggle: (key: string, def?: boolean) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

type Persisted = Pick<SessionState, "route" | "recent" | "open" | "calc" | "sim" | "battle" | "dismissed">;

function persist(s: SessionState) {
  if (!s.wsId) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const battle = s.battle ? { ...s.battle, log: s.battle.log.slice(-1500) } : null;
    const data: Persisted = { route: s.route, recent: s.recent, open: s.open, calc: s.calc, sim: s.sim, battle, dismissed: s.dismissed };
    if (!writeJSON("session." + s.wsId, data)) writeJSON("session." + s.wsId, { ...data, battle: null });
  }, 300);
}

export const useSession = create<SessionState>((set, get) => ({
  wsId: "",
  route: "#/",
  recent: [],
  open: {},
  calc: null,
  sim: null,
  battle: null,
  dismissed: {},
  load: (wsId) => {
    const d = readJSON<Partial<Persisted>>("session." + wsId) ?? {};
    set({
      wsId,
      route: d.route ?? "#/",
      recent: d.recent ?? [],
      open: d.open ?? {},
      calc: d.calc ?? null,
      sim: d.sim ?? null,
      battle: d.battle ?? null,
      dismissed: d.dismissed ?? readJSON<Record<string, boolean>>("dismissed") ?? {},
    });
  },
  set: (patch) => {
    set(patch);
    persist(get());
    if (patch.dismissed) writeJSON("dismissed", patch.dismissed);
  },
  touch: (kind, id) => {
    const recent = [{ kind, id, at: Date.now() }, ...get().recent.filter((r) => !(r.kind === kind && r.id === id))].slice(0, 12);
    set({ recent });
    persist(get());
  },
  toggle: (key, def = true) => {
    const open = { ...get().open, [key]: !(get().open[key] ?? def) };
    set({ open });
    persist(get());
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (timer) {
      clearTimeout(timer);
      const s = useSession.getState();
      const battle = s.battle ? { ...s.battle, log: s.battle.log.slice(-1500) } : null;
      writeJSON("session." + s.wsId, { route: s.route, recent: s.recent, open: s.open, calc: s.calc, sim: s.sim, battle, dismissed: s.dismissed });
    }
  });
}
