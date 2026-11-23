/// <reference lib="webworker" />
// Runs the heavy simulations off the main thread so the page never freezes.
import { runCalc, type CalcInput } from "./calc";
import { runBatch, type BatchOptions } from "./batch";
import type { BattleSetup } from "./setup";

type Msg =
  | { id: number; type: "calc"; payload: CalcInput }
  | { id: number; type: "batch"; payload: { setup: BattleSetup; opts: BatchOptions } };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  try {
    if (msg.type === "calc") {
      ctx.postMessage({ id: msg.id, result: runCalc(msg.payload) });
    } else if (msg.type === "batch") {
      const result = runBatch(msg.payload.setup, msg.payload.opts, (done) => ctx.postMessage({ id: msg.id, progress: done / msg.payload.opts.runs }));
      ctx.postMessage({ id: msg.id, result });
    }
  } catch (e) {
    ctx.postMessage({ id: msg.id, error: e instanceof Error ? e.message : String(e) });
  }
};
