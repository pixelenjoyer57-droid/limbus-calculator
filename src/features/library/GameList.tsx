// Searchable, filterable list of game (wiki) items. Renders at most 60 rows at a time.
import { useDeferredValue, useMemo, useState } from "react";
import { GIFT_KEYWORDS, type CustomStatus, type Ego, type Enemy, type Gift, type Identity } from "../../data/schema";
import { GIFT_TIERS, RARITY_LABEL, SINNERS } from "../../engine/constants";
import { useGameData, useGameItems } from "../../gamedata/store";
import type { GameItem, GameItemMap, GameKind } from "../../gamedata/types";
import { href } from "../../lib/router";
import { Icon } from "../../ui/icons";
import { Button, Check, Select } from "../../ui/controls";
import { EmptyState, Notice } from "../../ui/layout";
import { GradeBadge } from "../../ui/game";
import { KIND_INFO } from "./kinds";
import "./gamedata.css";

const PAGE = 60;

export const isNoTier = (g: Gift) => g.tags.includes("No tier (story/other)");
export const isLegacy = (g: Gift) => g.tags.includes("Legacy");
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function gameSubtitle(item: GameItem): string {
  switch (item.kind) {
    case "identity": {
      const x = item as Identity;
      return `${x.sinner} · ${RARITY_LABEL[x.rarity]} · HP ${x.hp}`;
    }
    case "ego": {
      const x = item as Ego;
      return `${x.sinner} · ${x.grade} · ${x.spCost} SP`;
    }
    case "enemy": {
      const x = item as Enemy;
      return `Lv ${x.level} · HP ${x.hp} · ${x.parts.length ? `${x.parts.length} parts` : `${x.skills.length} skills`}`;
    }
    case "gift": {
      const x = item as Gift;
      return `${isNoTier(x) ? "No tier" : `Tier ${x.tier}`} · ${x.keyword === "NONE" ? "no keyword" : cap(x.keyword)} · ${x.cost} cost`;
    }
    default: {
      const x = item as CustomStatus;
      const d = x.description.replace(/\s+/g, " ").trim();
      return `${cap(x.polarity)}${d ? ` · ${d.length > 70 ? d.slice(0, 70) + "…" : d}` : ""}`;
    }
  }
}

const hay = new WeakMap<object, string>();
function haystack(x: GameItem): string {
  let h = hay.get(x);
  if (h === undefined) {
    const a = x as unknown as { name: string; source: string; tags: string[]; sinner?: string; traits?: string[]; keyword?: string; grade?: string };
    h = [a.name, a.source, a.sinner, a.keyword, a.grade, ...a.tags, ...(a.traits ?? [])].filter(Boolean).join(" | ").toLowerCase();
    hay.set(x, h);
  }
  return h;
}
const sortKey = (n: string) => n.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();

export default function GameList({ kind, selectedId }: { kind: GameKind; selectedId?: string }) {
  const info = KIND_INFO[kind];
  const { status, items, error, retry } = useGameItems(kind);
  const [query, setQuery] = useState("");
  const [sinner, setSinner] = useState("");
  const [tier, setTier] = useState("");
  const [keyword, setKeyword] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const q = useDeferredValue(query);
  const total = useGameData((s) => s.index?.counts[kind === "identity" ? "identities" : kind === "enemy" ? "enemies" : kind === "ego" ? "egos" : kind === "gift" ? "gifts" : "statuses"]);

  const sorted = useMemo(() => [...items].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name))), [items]);
  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sorted.filter((x) => {
      if (sinner && (x as Identity).sinner !== sinner) return false;
      if (kind === "gift") {
        const g = x as Gift;
        if (!legacy && isLegacy(g)) return false;
        if (tier && (tier === "none" ? !isNoTier(g) : isNoTier(g) || g.tier !== tier)) return false;
        if (keyword && g.keyword !== keyword) return false;
      }
      const h = haystack(x);
      return words.every((w) => h.includes(w));
    });
  }, [sorted, q, sinner, tier, keyword, legacy, kind]);

  const reset = () => setShown(PAGE);

  if (status === "error")
    return (
      <Notice kind="error">
        <p style={{ margin: 0 }}>{error}</p>
        <div style={{ marginTop: 8 }}>
          <Button small onClick={retry}>Retry</Button>
        </div>
      </Notice>
    );
  if (status !== "ready")
    return (
      <p className="muted" role="status">
        Loading game data… {total ?? ""} {info.plural.toLowerCase()}
      </p>
    );

  return (
    <div className="stack">
      <div className="field">
        <label className="sr-only" htmlFor="gd-search">Search {info.plural} from the game</label>
        <input
          id="gd-search"
          className="input"
          type="search"
          placeholder={`Search ${info.plural.toLowerCase()}, tags, sources…`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); reset(); }}
        />
      </div>
      {(kind === "identity" || kind === "ego") && (
        <Select label="Sinner" value={sinner} onChange={(v) => { setSinner(v); reset(); }} options={SINNERS.map((s) => ({ value: s, label: s }))} placeholder="All sinners" />
      )}
      {kind === "gift" && (
        <div className="gd-filters">
          <Select label="Tier" value={tier} onChange={(v) => { setTier(v); reset(); }} placeholder="All tiers" options={[...GIFT_TIERS.map((t) => ({ value: t as string, label: `Tier ${t}` })), { value: "none", label: "No tier" }]} />
          <Select label="Keyword" value={keyword} onChange={(v) => { setKeyword(v); reset(); }} placeholder="All keywords" options={GIFT_KEYWORDS.filter((k) => k !== "NONE").map((k) => ({ value: k as string, label: cap(k) }))} />
          <div className="full">
            <Check label="Show legacy gifts" checked={legacy} onChange={(v) => { setLegacy(v); reset(); }} />
          </div>
        </div>
      )}
      <p className="gd-count" role="status">
        Showing {Math.min(shown, filtered.length)} of {filtered.length}
        {filtered.length !== items.length ? ` (${items.length} in total)` : ""}
      </p>
      {filtered.length === 0 ? (
        <EmptyState title="Nothing matches">Try fewer words or clear a filter.</EmptyState>
      ) : (
        <div className="list" role="list">
          {filtered.slice(0, shown).map((x) => (
            <a key={x.id} role="listitem" className="list-item" href={href(`/build/${info.slug}/${x.id}`)} aria-current={x.id === selectedId ? "true" : undefined} style={{ textDecoration: "none" }}>
              <Icon name={info.icon} />
              <span className="li-main">
                <span className="li-name">{x.name || "Untitled"}</span>
                <span className="li-sub">{gameSubtitle(x as GameItemMap[GameKind])}</span>
              </span>
              {x.kind === "ego" && <GradeBadge grade={(x as Ego).grade} />}
            </a>
          ))}
        </div>
      )}
      {filtered.length > shown && (
        <Button block onClick={() => setShown(shown + PAGE)}>
          Show more ({filtered.length - shown} left)
        </Button>
      )}
    </div>
  );
}
