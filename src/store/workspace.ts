// The active workspace (all authored content) with autosave and undo/redo.
import { create } from "zustand";
import { produce, type Draft } from "immer";
import { COLLECTION, type AnyContent, type ContentKind, type Workspace } from "../data/schema";
import { emptyWorkspace, sampleWorkspace } from "../data/defaults";
import { countItems, migrateWorkspace } from "../data/migrate";
import { readJSON, removeKey, writeJSON } from "./storage";

export interface WsMeta {
  id: string;
  name: string;
  updatedAt: number;
  count: number;
}
interface Index {
  activeId: string;
  list: WsMeta[];
}

type SaveStatus = "saved" | "pending" | "error";

interface WorkspaceState {
  ready: boolean;
  firstRun: boolean;
  index: Index;
  ws: Workspace;
  past: Workspace[];
  future: Workspace[];
  save: { status: SaveStatus; at: number };
  lastExportAt: number;
  init: () => void;
  edit: (recipe: (d: Draft<Workspace>) => void, coalesceKey?: string) => void;
  upsert: (item: AnyContent, coalesceKey?: string) => void;
  remove: (kind: ContentKind, id: string) => AnyContent | undefined;
  undo: () => void;
  redo: () => void;
  switchTo: (id: string) => void;
  create: (name: string, mode: "empty" | "sample" | "copy") => string;
  adopt: (ws: Workspace) => string;
  rename: (name: string) => void;
  deleteWorkspace: (id: string) => void;
  markExported: () => void;
  flush: () => void;
}

const MAX_HISTORY = 80;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastKey: string | null = null;
let lastTime = 0;

const meta = (ws: Workspace): WsMeta => ({ id: ws.id, name: ws.name, updatedAt: ws.updatedAt, count: countItems(ws) });

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const schedule = () => {
    set({ save: { status: "pending", at: get().save.at } });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => get().flush(), 450);
  };

  const commit = (next: Workspace, coalesceKey?: string) => {
    const { ws, past } = get();
    if (next === ws) return;
    const now = Date.now();
    const coalesce = !!coalesceKey && coalesceKey === lastKey && now - lastTime < 1500;
    lastKey = coalesceKey ?? null;
    lastTime = now;
    const nextPast = coalesce ? past : [...past.slice(-(MAX_HISTORY - 1)), ws];
    const stamped = produce(next, (d) => {
      d.updatedAt = now;
    });
    const index = { ...get().index, list: get().index.list.map((m) => (m.id === stamped.id ? meta(stamped) : m)) };
    set({ ws: stamped, past: nextPast, future: [], index });
    schedule();
  };

  return {
    ready: false,
    firstRun: false,
    index: { activeId: "", list: [] },
    ws: emptyWorkspace(),
    past: [],
    future: [],
    save: { status: "saved", at: 0 },
    lastExportAt: 0,

    init: () => {
      if (get().ready) return;
      let index = readJSON<Index>("index");
      let ws: Workspace | null = null;
      let firstRun = false;
      if (index?.activeId) {
        const raw = readJSON<unknown>("ws." + index.activeId);
        if (raw) ws = migrateWorkspace(raw);
      }
      if (!ws && index?.list.length) {
        for (const m of index.list) {
          const raw = readJSON<unknown>("ws." + m.id);
          if (raw) {
            ws = migrateWorkspace(raw);
            break;
          }
        }
      }
      if (!ws) {
        ws = sampleWorkspace();
        firstRun = true;
      }
      if (!index) index = { activeId: ws.id, list: [] };
      index.activeId = ws.id;
      if (!index.list.some((m) => m.id === ws!.id)) index.list.push(meta(ws));
      index.list = index.list.map((m) => (m.id === ws!.id ? meta(ws!) : m));
      set({ ready: true, firstRun, ws, index, past: [], future: [], lastExportAt: readJSON<number>("lastExport") ?? 0 });
      writeJSON("index", index);
      writeJSON("ws." + ws.id, ws);
      set({ save: { status: "saved", at: Date.now() } });
    },

    edit: (recipe, coalesceKey) => commit(produce(get().ws, recipe), coalesceKey),

    upsert: (item, coalesceKey) =>
      commit(
        produce(get().ws, (d) => {
          const arr = d[COLLECTION[item.kind as ContentKind]] as unknown as AnyContent[];
          const i = arr.findIndex((x) => x.id === item.id);
          const stamped = { ...item, updatedAt: Date.now() } as AnyContent;
          if (i >= 0) arr[i] = stamped;
          else arr.push(stamped);
        }),
        coalesceKey,
      ),

    remove: (kind, id) => {
      const arr = get().ws[COLLECTION[kind]] as unknown as AnyContent[];
      const item = arr.find((x) => x.id === id);
      if (!item) return undefined;
      commit(
        produce(get().ws, (d) => {
          const a = d[COLLECTION[kind]] as unknown as AnyContent[];
          const i = a.findIndex((x) => x.id === id);
          if (i >= 0) a.splice(i, 1);
        }),
      );
      return item;
    },

    undo: () => {
      const { past, ws, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      lastKey = null;
      set({ ws: prev, past: past.slice(0, -1), future: [ws, ...future].slice(0, MAX_HISTORY) });
      schedule();
    },

    redo: () => {
      const { past, ws, future } = get();
      const next = future[0];
      if (!next) return;
      lastKey = null;
      set({ ws: next, past: [...past, ws].slice(-MAX_HISTORY), future: future.slice(1) });
      schedule();
    },

    flush: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const { ws, index } = get();
      const ok = writeJSON("ws." + ws.id, ws) && writeJSON("index", { ...index, activeId: ws.id });
      set({ save: { status: ok ? "saved" : "error", at: Date.now() } });
    },

    switchTo: (id) => {
      if (id === get().ws.id) return;
      get().flush();
      const raw = readJSON<unknown>("ws." + id);
      if (!raw) return;
      const ws = migrateWorkspace(raw);
      const index = { ...get().index, activeId: ws.id };
      set({ ws, index, past: [], future: [] });
      writeJSON("index", index);
    },

    create: (name, mode) => {
      get().flush();
      let ws: Workspace;
      if (mode === "sample") ws = { ...sampleWorkspace(), name };
      else if (mode === "copy") ws = { ...structuredClone(get().ws), id: emptyWorkspace().id, name, createdAt: Date.now() };
      else ws = emptyWorkspace(name);
      return get().adopt(ws);
    },

    adopt: (incoming) => {
      get().flush();
      let ws = incoming;
      if (get().index.list.some((m) => m.id === ws.id)) ws = { ...ws, id: emptyWorkspace().id };
      const index = { activeId: ws.id, list: [...get().index.list, meta(ws)] };
      set({ ws, index, past: [], future: [] });
      writeJSON("ws." + ws.id, ws);
      writeJSON("index", index);
      return ws.id;
    },

    rename: (name) => {
      get().edit((d) => {
        d.name = name.slice(0, 80) || "Untitled workshop";
      }, "ws-name");
    },

    deleteWorkspace: (id) => {
      const list = get().index.list.filter((m) => m.id !== id);
      removeKey("ws." + id);
      removeKey("session." + id);
      if (!list.length) {
        const ws = emptyWorkspace();
        const index = { activeId: ws.id, list: [meta(ws)] };
        set({ ws, index, past: [], future: [] });
        writeJSON("ws." + ws.id, ws);
        writeJSON("index", index);
        return;
      }
      if (id === get().ws.id) {
        const raw = readJSON<unknown>("ws." + list[0].id);
        const ws = raw ? migrateWorkspace(raw) : emptyWorkspace();
        set({ ws, past: [], future: [] });
      }
      const index = { activeId: get().ws.id, list };
      set({ index });
      writeJSON("index", index);
    },

    markExported: () => {
      const t = Date.now();
      set({ lastExportAt: t });
      writeJSON("lastExport", t);
    },
  };
});

if (typeof window !== "undefined") {
  const flush = () => {
    if (useWorkspace.getState().save.status === "pending") useWorkspace.getState().flush();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Convenience selectors */
export function useCollection<K extends keyof Workspace>(key: K): Workspace[K] {
  return useWorkspace((s) => s.ws[key]);
}
