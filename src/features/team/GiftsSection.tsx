// The "E.G.O Gifts" section of a team: a grid of gift buttons to turn gifts on and off, and the team's own list
// (level and remove per entry).
import type { Draft } from "immer";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GIFT_KEYWORDS, type Gift, type Team } from "../../data/schema";
import { GIFT_TIERS } from "../../engine/constants";
import { useGameData, useGameItems } from "../../gamedata";
import { useWorkspace } from "../../store/workspace";
import { toast } from "../../store/toast";
import { Button, Check, Select } from "../../ui/controls";
import { Icon } from "../../ui/icons";
import { EmptyState, Notice, Tabs } from "../../ui/layout";
import { ContentPicker, useResolvedItem } from "../../ui/ContentPicker";
import { showingText } from "../../lib/search";
import { usePagedSearch } from "../../ui/usePagedSearch";
import { capWord, giftPasses, keywordText, tierText, isNoTier } from "../library/giftFilter";
import { countText, giftButtonName, limitMessage, restoreGift, toggleGift } from "./giftToggle";
import { useGiftGrid } from "./giftGridState";
import "./giftgrid.css";

const tierKey = (g: Gift) => (isNoTier(g) ? "none" : g.tier);

const GiftButton = memo(function GiftButton({ gift, on, own, index, onToggle }: { gift: Gift; on: boolean; own: boolean; index: number; onToggle: (g: Gift) => void }) {
  return (
    <button
      type="button"
      className="gg-btn"
      aria-pressed={on}
      aria-label={giftButtonName(gift, tierText(gift), keywordText(gift), own)}
      data-gg-index={index}
      onClick={() => onToggle(gift)}
    >
      <span className="gg-name">{gift.name || "Untitled"}</span>{" "}
      <span className="gg-meta">
        <span className="gg-tier" data-tier={tierKey(gift)}>{tierText(gift)}</span>{" "}
        <span className="gg-kw">{keywordText(gift)}</span>
      </span>
      <span className="gg-on" aria-hidden="true">
        {on && <Icon name="check" size={22} />}
      </span>
    </button>
  );
});

function GiftGrid({ teamId, gifts, setMsg, onSnapshotNeeded }: { teamId: string; gifts: Team["gifts"]; setMsg: (m: string) => void; onSnapshotNeeded: number }) {
  const g = useGiftGrid();
  const own = useWorkspace((s) => s.ws.gifts);
  const game = useGameItems("gift", g.tab === "game");
  const total = useGameData((s) => s.index?.counts.gifts);
  const selected = useMemo(() => new Set(gifts.map((x) => x.giftId)), [gifts]);
  // "Show selected only" uses the gifts that were on when the filter was applied, so a gift you turn off
  // does not vanish from under your focus.
  const [snap, setSnap] = useState(selected);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refreshSnap = useCallback(() => setSnap(selectedRef.current), []);
  useEffect(() => refreshSnap(), [onSnapshotNeeded, refreshSnap]);

  const source = g.tab === "own" ? own : (game.items as Gift[]);
  const extra = useMemo(() => {
    const f = { tier: g.tier, keyword: g.keyword, legacy: g.legacy };
    return (x: Gift) => giftPasses(x, f) && (!g.selectedOnly || snap.has(x.id));
  }, [g.tier, g.keyword, g.legacy, g.selectedOnly, snap]);
  const { query, setQuery, results, shown, visible, resetPaging, showMore } = usePagedSearch(source, extra, { initialQuery: g.query, onQueryChange: (q) => g.set({ query: q }) });

  const change = (patch: Parameters<typeof g.set>[0]) => {
    g.set(patch);
    resetPaging();
    refreshSnap();
  };
  const clear = () => {
    g.clear();
    setQuery("");
    resetPaging();
    refreshSnap();
  };

  const toggle = useCallback(
    (gift: Gift) => {
      const s = useWorkspace.getState();
      const team = s.ws.teams.find((t) => t.id === teamId);
      if (!team) return;
      const r = toggleGift(team.gifts, gift.id);
      if (r.kind === "limit") {
        setMsg(limitMessage);
        return;
      }
      s.upsert({ ...team, gifts: r.gifts });
      const name = gift.name || "Untitled";
      if (r.kind === "added") {
        setMsg(`Added ${name}.`);
      } else {
        // The toast announces the removal and offers Undo; the count line announces the new count.
        setMsg("");
        toast(`Removed ${name}.`, "ok", {
          label: "Undo",
          run: () => {
            const st = useWorkspace.getState();
            const t = st.ws.teams.find((x) => x.id === teamId);
            const back = t && restoreGift(t.gifts, r.entry, r.index);
            if (!t || !back) {
              setMsg(`Could not put ${name} back. ${limitMessage}`);
              return;
            }
            st.upsert({ ...t, gifts: back });
            setMsg(""); // the count line announces the new count
          },
        });
      }
    },
    [teamId, setMsg],
  );

  // Status for screen readers: updated once typing pauses, not on every key.
  const isOwnTab = g.tab === "own";
  const loading = g.tab === "game" && game.status !== "ready" && game.status !== "error";
  const failed = !isOwnTab && game.status === "error";
  const statusText = showingText(results.length, shown, undefined);
  const [settled, setSettled] = useState("");
  useEffect(() => {
    if (loading || failed) return;
    const t = setTimeout(() => setSettled(statusText), 500);
    return () => clearTimeout(t);
  }, [statusText, loading, failed]);

  // After "Show more": focus stays on the button; if it goes away (nothing left), focus the first new gift.
  const wrap = useRef<HTMLDivElement>(null);
  const firstNew = useRef<number | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (firstNew.current === null) return;
    if (!moreRef.current) wrap.current?.querySelector<HTMLElement>(`[data-gg-index="${firstNew.current}"]`)?.focus();
    firstNew.current = null;
  }, [shown]);
  const more = () => {
    firstNew.current = visible.length;
    showMore();
  };

  const isOwn = g.tab === "own";
  const sourceTotal = isOwn ? own.length : game.status === "ready" ? game.items.length : total;
  return (
    <div ref={wrap} className="gg">
      <Tabs
        label="Where gifts come from"
        value={g.tab}
        onChange={(v) => change({ tab: v })}
        tabs={[
          { value: "own", label: `Your content (${own.length})` },
          { value: "game", label: `From the game (${game.status === "ready" ? game.items.length : total ?? "…"})` },
        ]}
      />
      <div className="gg-filters">
        <div className="field full">
          <label className="label" htmlFor="gg-search">Search gifts</label>
          <input id="gg-search" className="input" type="search" maxLength={200} placeholder="Name, keyword, tag, source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select label="Tier" value={g.tier} onChange={(v) => change({ tier: v })} placeholder="All tiers" options={[...GIFT_TIERS.map((t) => ({ value: t as string, label: t === "EX" ? "EX" : `Tier ${t}` })), { value: "none", label: "No tier" }]} />
        <Select label="Keyword" value={g.keyword} onChange={(v) => change({ keyword: v })} placeholder="All keywords" options={GIFT_KEYWORDS.filter((k) => k !== "NONE").map((k) => ({ value: k as string, label: capWord(k) }))} />
        <Check label="Show legacy gifts" checked={g.legacy} onChange={(v) => change({ legacy: v })} />
        <Check label="Show selected only" checked={g.selectedOnly} onChange={(v) => change({ selectedOnly: v })} />
        <div className="gg-actions full">
          <Button small onClick={clear}>Clear filters</Button>
          <Button small onClick={() => document.getElementById("gg-team-heading")?.focus()}>Go to your team's gifts</Button>
        </div>
      </div>
      <p className="gd-count" aria-hidden="true">{loading || failed ? "" : showingText(results.length, shown, sourceTotal)}</p>
      <p className="sr-only" role="status">{loading || failed ? "" : settled}</p>
      <div role="tabpanel" aria-label={isOwn ? "Your content" : "From the game"}>
        {!isOwn && game.status === "error" ? (
          <Notice kind="error">
            <p style={{ margin: 0 }}>{game.error || "The game gifts could not be loaded."}</p>
            <div style={{ marginTop: 8 }}><Button small onClick={game.retry}>Retry</Button></div>
          </Notice>
        ) : loading ? (
          <p className="muted" role="status">Loading game gifts…</p>
        ) : results.length === 0 ? (
          <div role="status">
            <EmptyState title="Nothing matches">
              {isOwn && own.length === 0 ? `You haven't made any gifts yet. Try the "From the game" tab.` : "Try fewer words, or clear a filter."}
            </EmptyState>
          </div>
        ) : (
          <>
            <div role="group" aria-label={isOwn ? "Your gifts" : "Gifts from the game"} className="gg-grid">
              {visible.map((x, i) => (
                <GiftButton key={x.id} gift={x} on={selected.has(x.id)} own={isOwn} index={i} onToggle={toggle} />
              ))}
            </div>
            {results.length > shown && (
              <div style={{ marginTop: 12 }}>
                <button type="button" ref={moreRef} className="btn block" onClick={more}>
                  Show more ({results.length - shown} left)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TeamGiftRow({ giftId, level, onLevel, onPick, onRemove }: { giftId: string; level: number; onLevel: (n: number) => void; onPick: (id: string | null) => void; onRemove: () => void }) {
  const gift = useResolvedItem("gift", giftId).item;
  return (
    <div className="row gg-row">
      <div className="gg-row-pick">
        <ContentPicker kind="gift" label="Gift" value={giftId} onChange={onPick} />
      </div>
      <div className="gg-row-level">
        <Select
          label="Enhanced"
          value={String(level)}
          onChange={(v) => onLevel(Number(v))}
          options={[{ value: "0", label: "Base" }, { value: "1", label: "+", disabled: !gift?.plus1 }, { value: "2", label: "++", disabled: !gift?.plus2 }]}
        />
      </div>
      <button type="button" className="btn ghost small icon" aria-label="Remove gift" title="Remove gift" data-remove-gift onClick={onRemove}>
        <Icon name="trash" size={17} />
      </button>
    </div>
  );
}

export function GiftsSection({ team, edit }: { team: Team; edit: (fn: (d: Draft<Team>) => void, key?: string) => void }) {
  const [msg, setMsg] = useState("");
  const [snapTick, setSnapTick] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<number | null>(null);
  const n = team.gifts.length;

  useEffect(() => {
    const i = focusAfter.current;
    if (i === null) return;
    focusAfter.current = null;
    const buttons = list.current?.querySelectorAll<HTMLElement>("[data-remove-gift]");
    const target = buttons && buttons.length ? buttons[Math.min(i, buttons.length - 1)] : heading.current;
    target?.focus();
  }, [n]);

  const remove = (i: number) => {
    focusAfter.current = i;
    edit((d) => void d.gifts.splice(i, 1));
    setMsg("Removed gift.");
    setSnapTick((t) => t + 1);
  };

  return (
    <div className="stack">
      <p className="gg-count" role="status">{countText(n)}</p>
      <p className="gg-msg" role="status">{msg}</p>
      <GiftGrid teamId={team.id} gifts={team.gifts} setMsg={setMsg} onSnapshotNeeded={snapTick} />
      <div ref={list}>
        <h4 id="gg-team-heading" ref={heading} tabIndex={-1} className="gg-heading">Your team's gifts ({n})</h4>
        {n === 0 && <p className="muted">No gifts yet. Press gifts in the grid above to add them.</p>}
        {team.gifts.map((g, i) => (
          <TeamGiftRow key={i} giftId={g.giftId} level={g.level} onLevel={(lv) => edit((d) => void (d.gifts[i].level = lv))} onPick={(v) => v && edit((d) => void (d.gifts[i].giftId = v))} onRemove={() => remove(i)} />
        ))}
      </div>
    </div>
  );
}
