// Promise wrapper around the simulation worker, with a main-thread fallback.
import type { CalcInput, CalcResult } from "../engine/calc";
import type { BatchOptions, BatchResult } from "../engine/batch";
import type { BattleSetup } from "../engine/setup";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ id: number; result?: unknown; error?: string; progress?: number }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      if (ev.data.progress !== undefined) {
        p.progress?.(ev.data.progress);
        return;
      }
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.result);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error("The simulation worker stopped."));
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function call<T>(type: string, payload: unknown, progress?: (p: number) => void): Promise<T> {
  const w = getWorker();
  if (!w) return fallback<T>(type, payload);
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    w.postMessage({ id, type, payload });
  });
}

async function fallback<T>(type: string, payload: unknown): Promise<T> {
  if (type === "calc") {
    const { runCalc } = await import("../engine/calc");
    return runCalc(payload as CalcInput) as T;
  }
  const { runBatch } = await import("../engine/batch");
  const p = payload as { setup: BattleSetup; opts: BatchOptions };
  return runBatch(p.setup, p.opts) as T;
}

export const runCalcAsync = (input: CalcInput) => call<CalcResult>("calc", input);
export const runBatchAsync = (setup: BattleSetup, opts: BatchOptions, progress?: (p: number) => void) =>
  call<BatchResult>("batch", { setup, opts }, progress);
