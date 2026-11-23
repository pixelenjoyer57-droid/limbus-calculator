// Status names on the wiki → simulator status keys. Built-in statuses keep their
// engine keys (BURN, FRAGILE …); every other wiki status becomes a tracked
// "game status" (G_…) with the wiki's description, so conditions like
// "At 5+ Festive Fever" still work even though its own effect is not simulated.
import { BUILTIN_STATUS_LIST } from "../../src/engine/statuses";
import type { CustomStatus } from "../../src/data/schema";
import type { LuaTable } from "./lua";
import { clean } from "./text";
import type { StatusInfo } from "./effects";

const ALIASES: Record<string, string> = {
  "damage up": "DAMAGE_UP",
  "dmg up": "DAMAGE_UP",
  "damage down": "DAMAGE_DOWN",
  "dmg down": "DAMAGE_DOWN",
  fragility: "FRAGILE",
  "attack power up": "ATTACK_POWER_UP",
  "attack power down": "ATTACK_POWER_DOWN",
  "defense power up": "DEFENSE_POWER_UP",
  "defense power down": "DEFENSE_POWER_DOWN",
  "offense level up": "OFFENSE_LEVEL_UP",
  "offense level down": "OFFENSE_LEVEL_DOWN",
  "defense level up": "DEFENSE_LEVEL_UP",
  "defense level down": "DEFENSE_LEVEL_DOWN",
  "n corp’s nails": "NAILS",
  "n corp's nails": "NAILS",
};

/** Short stable hash (FNV-1a, base 36) to keep keys unique and non-empty. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** "Dimensional Rift" → "G_DIMENSIONAL_RIFT". Always non-empty and short enough for ids (≤ 80 chars). */
export function snakeKey(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase()
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");
  return "G_" + (base || "S" + shortHash(name));
}

export class StatusRegistry {
  private byName = new Map<string, StatusInfo>();
  private game = new Map<string, CustomStatus>();
  /** key → full wiki name (names are shortened in the output) */
  private keyName = new Map<string, string>();
  private used = new Set<string>();
  private data: LuaTable;

  constructor(wikiStatuses: LuaTable) {
    this.data = wikiStatuses;
    for (const b of BUILTIN_STATUS_LIST) this.byName.set(b.name.toLowerCase(), { key: b.key, mode: b.mode });
    for (const [alias, key] of Object.entries(ALIASES)) {
      const b = BUILTIN_STATUS_LIST.find((x) => x.key === key);
      if (b) this.byName.set(alias, { key, mode: b.mode });
    }
  }

  lookup = (rawName: string): StatusInfo => {
    const name = rawName.trim();
    const k = name.toLowerCase();
    const hit = this.byName.get(k);
    if (hit) {
      this.used.add(hit.key);
      return hit;
    }
    // wiki status
    const entry = (this.data[name] ?? Object.entries(this.data).find(([n]) => n.toLowerCase() === k)?.[1]) as LuaTable | undefined;
    const desc = entry && typeof entry.desc === "string" ? clean(entry.desc) : "";
    const stype = entry && typeof entry.stype === "string" ? entry.stype : "";
    // Wiki descriptions use X for the main value and Y for a second value (Count)
    const pc = /\bY\b/.test(desc) || /\bCount\b/.test(desc);
    let key = snakeKey(name);
    // different statuses can share a (shortened) key: keep them apart
    if (this.keyName.has(key) && this.keyName.get(key) !== name) key = `${key}_${shortHash(name)}`;
    this.keyName.set(key, name);
    const info: StatusInfo = { key, mode: pc ? "pc" : "value" };
    this.byName.set(k, info);
    if (!this.game.has(key)) {
      this.game.set(key, {
        id: "g:status:" + key.slice(2).toLowerCase(),
        kind: "status",
        key,
        name: name.slice(0, 60),
        polarity: stype === "b" ? "positive" : stype === "d" ? "negative" : "neutral",
        mode: info.mode,
        maxPotency: 99,
        maxCount: 99,
        turnEnd: "none",
        countsAs: /^unique (burn|bleed|tremor|rupture|sinking|poise|charge)/i.test(desc) ? desc.match(/^unique (\w+)/i)![1].toUpperCase() : null,
        description: (desc || "No description on the wiki.").slice(0, 1000),
        effects: [],
        notes: "Tracked by the simulator (Potency/Count and conditions that check it). Its own effect is not simulated — see the description.",
        tags: ["game data"],
        createdAt: 0,
        updatedAt: 0,
      });
    }
    this.used.add(key);
    return info;
  };

  /** Game statuses that were referenced by imported content. */
  gameStatuses(): CustomStatus[] {
    return [...this.game.values()].filter((g) => this.used.has(g.key)).sort((a, b) => a.name.localeCompare(b.name));
  }
}
