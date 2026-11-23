import { useEffect, useMemo, useState } from "react";
import { produce, type Draft } from "immer";
import { COLLECTION, type AnyContent, type CoinType, type ContentKind, type Ego, type Encounter, type Enemy, type GameEvent, type Gift, type Identity, type CustomStatus } from "../../data/schema";
import {
  ENEMY_TEMPLATES, IDENTITY_TEMPLATES, newCoinType, newEgo, newEncounter, newEnemy, newEvent, newGift, newIdentity, newStatus,
} from "../../data/defaults";
import { duplicateItem, encodeShareCode, itemsPayload } from "../../data/migrate";
import { RARITY_LABEL } from "../../engine/constants";
import { useWorkspace } from "../../store/workspace";
import { useSession } from "../../store/session";
import { toast } from "../../store/toast";
import { navigate, href } from "../../lib/router";
import { copyText, downloadJSON, slug } from "../../lib/files";
import { Icon } from "../../ui/icons";
import { Button, Segmented } from "../../ui/controls";
import { Dialog, EmptyState, Tabs } from "../../ui/layout";
import { GradeBadge } from "../../ui/game";
import { useGameData } from "../../gamedata/store";
import { GAME_FILE, type GameKind } from "../../gamedata/types";
import { KIND_INFO, SLUG_TO_KIND } from "./kinds";
import GameList from "./GameList";
import GameDataView from "./GameDataView";
import { EgoEditor, EnemyEditor, IdentityEditor, identityWarnings } from "./editors";
import { CoinTypeEditor, EncounterEditor, EventEditor, GiftEditor, StatusEditor } from "./editors2";
import type { Edit } from "./rules";

const GAME_CAPABLE: ContentKind[] = ["identity", "ego", "enemy", "gift", "status"];

const LIB_KINDS: ContentKind[] = ["identity", "ego", "enemy", "encounter", "event", "gift", "status", "coinType"];

function subtitle(item: AnyContent): string {
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
      return `Lv ${x.level} · HP ${x.hp}${x.parts.length ? ` · ${x.parts.length} parts` : ` · ${x.skills.length} skills`}`;
    }
    case "encounter": {
      const x = item as Encounter;
      const n = x.waves.reduce((a, w) => a + w.enemies.reduce((b, e) => b + e.count, 0), 0);
      return `${x.type} · ${x.waves.length} wave${x.waves.length === 1 ? "" : "s"} · ${n} enemies`;
    }
    case "event":
      return `${(item as GameEvent).choices.length} choices`;
    case "gift": {
      const x = item as Gift;
      return `Tier ${x.tier} · ${x.keyword === "NONE" ? "no keyword" : x.keyword.toLowerCase()}`;
    }
    case "status": {
      const x = item as CustomStatus;
      return `${x.polarity} · ${x.mode === "pc" ? "Potency + Count" : "single value"}`;
    }
    case "coinType": {
      const x = item as CoinType;
      return `${x.clash}${x.op === "multiply" ? ` · ×${x.mult} on Heads` : x.power !== null ? ` · Coin Power ${x.power}` : ""}${x.fixed !== "none" ? ` · always ${x.fixed}` : ""}`;
    }
    default:
      return "";
  }
}

function makeNew(kind: ContentKind): AnyContent {
  switch (kind) {
    case "identity":
      return newIdentity();
    case "ego":
      return newEgo();
    case "enemy":
      return newEnemy();
    case "encounter":
      return newEncounter();
    case "event":
      return newEvent();
    case "gift":
      return newGift();
    case "status":
      return newStatus();
    case "coinType":
      return newCoinType();
    default:
      return newIdentity();
  }
}

export default function Library({ kindSlug, itemId }: { kindSlug?: string; itemId?: string }) {
  const kind: ContentKind = (kindSlug && SLUG_TO_KIND[kindSlug]) || "identity";
  const info = KIND_INFO[kind];
  const ws = useWorkspace((s) => s.ws);
  const upsert = useWorkspace((s) => s.upsert);
  const remove = useWorkspace((s) => s.remove);
  const touch = useSession((s) => s.touch);
  const [query, setQuery] = useState("");
  const gameCapable = GAME_CAPABLE.includes(kind);
  const gameSelected = gameCapable && !!itemId && itemId.startsWith("g:");
  const gameFlag = useSession((s) => !!s.open[`lib.game.${kind}`]);
  const gameMode = gameCapable && (gameSelected || gameFlag);
  const gameIndex = useGameData((s) => s.index);
  const ensureIndex = useGameData((s) => s.ensureIndex);
  const [picker, setPicker] = useState(false);
  const [share, setShare] = useState<string | null>(null);
  const items = ws[COLLECTION[kind]] as unknown as AnyContent[];
  const item = itemId && !gameSelected ? items.find((x) => x.id === itemId) : undefined;
  const gameCount = gameIndex?.counts[GAME_FILE[kind as GameKind]?.count];
  const setGameMode = (on: boolean) => {
    const s = useSession.getState();
    s.set({ open: { ...s.open, [`lib.game.${kind}`]: on } });
    if (gameSelected || itemId) navigate(`/build/${info.slug}`);
  };

  useEffect(() => {
    if (gameCapable) void ensureIndex();
  }, [gameCapable, ensureIndex]);

  useEffect(() => {
    if (window.location.hash.includes("new=1")) {
      setPicker(true);
      navigate(`/build/${info.slug}`, true);
    }
  }, [info.slug]);
  useEffect(() => {
    if (item) touch(kind, item.id);
  }, [item?.id, kind, touch]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return list;
    const words = q.split(/\s+/);
    return list.filter((x) => {
      const h = `${"name" in x ? x.name : ""} | ${subtitle(x)} | ${"tags" in x ? (x.tags as string[]).join(" ") : ""}`.toLowerCase();
      return words.every((w) => h.includes(w));
    });
  }, [items, query]);

  const create = (made?: AnyContent) => {
    const x = made ?? makeNew(kind);
    upsert(x);
    setPicker(false);
    navigate(`/build/${info.slug}/${x.id}`);
    toast(`New ${info.label.toLowerCase()} created. It saves automatically.`);
  };

  const onNew = () => {
    if (kind === "identity" || kind === "enemy") setPicker(true);
    else create();
  };

  const edit: Edit<AnyContent> = (fn, key) => {
    if (!item) return;
    const next = produce(item, (d: Draft<AnyContent>) => fn(d));
    if (next !== item) upsert(next as AnyContent, key ? `${item.id}:${key}` : undefined);
  };

  const del = () => {
    if (!item) return;
    const removed = remove(kind, item.id);
    navigate(`/build/${info.slug}`);
    if (removed) toast(`Deleted "${"name" in removed ? removed.name : ""}".`, "info", { label: "Undo", run: () => useWorkspace.getState().undo() });
  };

  const switcher = gameCapable && (
    <div className="gd-switch">
      <Segmented
        label="Show"
        hideLabel
        value={gameMode ? "game" : "mine"}
        onChange={(v) => setGameMode(v === "game")}
        options={[
          { value: "mine", label: `My content (${items.length})` },
          { value: "game", label: `From the game (${gameCount ?? "…"})` },
        ]}
      />
    </div>
  );

  const listView = gameMode ? (
    <div className="stack">
      {switcher}
      <GameList kind={kind as GameKind} selectedId={gameSelected ? itemId : undefined} />
      {gameIndex && <p className="gd-foot">{gameIndex.attribution} Updated {gameIndex.wikiUpdatedAt.slice(0, 10)}.</p>}
    </div>
  ) : (
    <div className="stack">
      {switcher}
      <div className="row">
        <Button variant="primary" icon="plus" onClick={onNew}>
          New {info.label}
        </Button>
      </div>
      {items.length > 4 && (
        <div className="field">
          <label className="sr-only" htmlFor="lib-search">
            Search {info.plural}
          </label>
          <input id="lib-search" className="input" placeholder={`Search ${info.plural.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title={`No ${info.plural.toLowerCase()} yet`} action={<Button variant="primary" icon="plus" onClick={onNew}>Create one</Button>}>
          {info.blurb}.
        </EmptyState>
      ) : (
        <div className="list" role="list">
          {filtered.map((x) => {
            const warn = x.kind === "identity" ? identityWarnings(x as Identity).length : 0;
            return (
              <a key={x.id} role="listitem" className="list-item" href={href(`/build/${info.slug}/${x.id}`)} aria-current={x.id === itemId ? "true" : undefined} style={{ textDecoration: "none" }}>
                <Icon name={info.icon} />
                <span className="li-main">
                  <span className="li-name">{"name" in x ? x.name || "Untitled" : "Untitled"}</span>
                  <span className="li-sub">{subtitle(x)}</span>
                </span>
                {x.kind === "ego" && <GradeBadge grade={(x as Ego).grade} />}
                {warn > 0 && <span className="badge warn" title={`${warn} thing(s) to check`}>{warn}</span>}
              </a>
            );
          })}
          {!filtered.length && <p className="muted">Nothing matches "{query}".</p>}
        </div>
      )}
    </div>
  );

  let editor = null;
  if (item) {
    const props = { item: item as never, edit: edit as never };
    editor =
      kind === "identity" ? <IdentityEditor {...props} /> :
      kind === "ego" ? <EgoEditor {...props} /> :
      kind === "enemy" ? <EnemyEditor {...props} /> :
      kind === "encounter" ? <EncounterEditor {...props} /> :
      kind === "event" ? <EventEditor {...props} /> :
      kind === "gift" ? <GiftEditor {...props} /> :
      kind === "coinType" ? <CoinTypeEditor {...props} /> :
      <StatusEditor {...props} />;
  }

  return (
    <div>
      <Tabs
        label="Content types"
        value={kind}
        onChange={(k) => navigate(`/build/${KIND_INFO[k].slug}`)}
        tabs={LIB_KINDS.map((k) => ({ value: k, label: KIND_INFO[k].plural, count: (ws[COLLECTION[k]] as unknown[]).length }))}
      />
      <div className="split">
        <div className={`sticky-side ${item || gameSelected ? "hide-on-narrow" : ""}`}>{listView}</div>
        <div>
          {gameSelected ? (
            <GameDataView key={itemId} kind={kind as GameKind} id={itemId!} />
          ) : item ? (
            <div className="stack">
              <div className="card" style={{ padding: "12px 14px" }}>
                <div className="row">
                  <Button className="show-on-narrow" icon="back" variant="ghost" onClick={() => navigate(`/build/${info.slug}`)}>
                    All {info.plural.toLowerCase()}
                  </Button>
                  <h1 style={{ margin: 0, fontSize: "1.3rem", flex: 1, minWidth: 160 }}>{"name" in item ? item.name || "Untitled" : ""}</h1>
                  {(kind === "identity" || kind === "enemy") && (
                    <Button small icon="calc" onClick={() => navigate(`/calc?${kind === "identity" ? "attacker" : "defender"}=${kind}:${item.id}`)}>
                      Test in calculator
                    </Button>
                  )}
                  <Button small icon="copy" onClick={() => create(duplicateItem(item))} label="Duplicate">
                    Duplicate
                  </Button>
                  <Button small icon="download" label="Export as file" onClick={() => downloadJSON(`${slug("name" in item ? item.name : kind)}.${kind}.json`, itemsPayload([item]))}>
                    Export
                  </Button>
                  <Button small icon="share" label="Share code" onClick={() => setShare(encodeShareCode(itemsPayload([item])))}>
                    Share
                  </Button>
                  <Button small icon="trash" variant="danger" label="Delete" onClick={del}>
                    Delete
                  </Button>
                </div>
              </div>
              {editor}
            </div>
          ) : (
            <div className="hide-on-narrow">
              <EmptyState title={`Pick ${kind === "identity" || kind === "enemy" || kind === "encounter" || kind === "event" ? "an" : "a"} ${info.label.toLowerCase()}`} action={gameMode ? undefined : <Button icon="plus" onClick={onNew}>New {info.label}</Button>}>
                {gameMode ? "Choose one on the left to look at it. You can copy it to your workshop to edit." : "Choose one on the left to edit it, or make a new one."}
              </EmptyState>
            </div>
          )}
        </div>
      </div>

      <Dialog open={picker} onClose={() => setPicker(false)} title={`New ${info.label}: pick a starting point`}>
        <div className="grid two">
          {(kind === "identity" ? IDENTITY_TEMPLATES : ENEMY_TEMPLATES).map((t) => (
            <button key={t.id} type="button" className="template" onClick={() => create(t.make() as AnyContent)}>
              <strong>{t.name}</strong>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={!!share}
        onClose={() => setShare(null)}
        title="Share code"
        footer={
          <>
            <Button onClick={() => setShare(null)}>Close</Button>
            <Button variant="gold" icon="copy" onClick={() => share && copyText(share, "Share code copied")}>
              Copy code
            </Button>
          </>
        }
      >
        <p>Send this code to another device or a friend. Paste it in <strong>Save, share &amp; settings → Import</strong>.</p>
        <textarea className="input mono" readOnly rows={6} value={share ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="Share code" />
      </Dialog>
    </div>
  );
}
