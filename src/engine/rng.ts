// Small seeded PRNG (mulberry32). Its whole state is one 32-bit integer, so a
// battle can be saved, resumed and replayed exactly.

export interface Rng {
  state: number;
}

export function makeRng(seed: number): Rng {
  return { state: seed >>> 0 || 0x9e3779b9 };
}

/** Returns a float in [0, 1). */
export function next(r: Rng): number {
  let t = (r.state = (r.state + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function int(r: Rng, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(next(r) * (max - min + 1));
}

export function chance(r: Rng, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return next(r) < p;
}

export function pick<T>(r: Rng, arr: readonly T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(next(r) * arr.length)];
}

export function shuffle<T>(r: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomSeed(): number {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return (Math.random() * 4294967296) >>> 0;
}
