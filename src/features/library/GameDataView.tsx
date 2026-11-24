// Read-only view of one game (wiki) item, with "Copy to my workshop".
import { useState } from "react";
import type { Ego, Enemy, Gift, Identity, Passive, Skill, CustomStatus, Part, Effect } from "../../data/schema";
import { DMG_LABEL, SIN_LABEL, SINS, resistTierName } from "../../engine/constants";
import { copyToWorkshop, wikiUrl } from "../../gamedata/copy";
import { ensureGameData, useGameData, useGameItems } from "../../gamedata/store";
import type { GameItem, GameKind } from "../../gamedata/types";
import { navigate } from "../../lib/router";
import { toast } from "../../store/toast";
import { useWorkspace } from "../../store/workspace";
import { Button } from "../../ui/controls";
import { Card, EmptyState, Notice, Section, Stat } from "../../ui/layout";
import { GradeBadge } from "../../ui/game";
import { KIND_INFO } from "./kinds";
import { EffectsPreview } from "./rules";
import { SkillPreview } from "./skills";
import { isLegacy, isNoTier } from "./giftFilter";
import "./gamedata.css";

const MARK = "Not simulated (shown for reference):";

/** Notes text: plain part first, then the sentences the simulator ignores, with a badge. */
export function GameNotes({ text }: { text: string }) {
  if (!text.trim()) return null;
  const i = text.indexOf(MARK);
  const plain = (i >= 0 ? text.slice(0, i) : text).trim();
  const ns = i >= 0 ? text.slice(i + MARK.length).trim() : "";
  return (
    <>
      {plain && (
        <div className="gd-note">
          <p>{plain}</p>
        </div>
      )}
      {ns && (
        <div className="gd-note ns">
          <span className="badge warn">Not simulated</span>
          <p className="muted small" style={{ marginTop: 0 }}>The simulator ignores these sentences. They are here for reference.</p>
          <p>{ns}</p>
        </div>
      )}
    </>
  );
}

const fmtX = (v: number) => `×${Math.round(v * 100) / 100}`;

function Resists({ resist, sinResist }: { resist: { SLASH: number; PIERCE: number; BLUNT: number }; sinResist?: Record<string, number> }) {
  const sins = sinResist ? SINS.filter((s) => Math.abs((sinResist[s] ?? 1) - 1) > 1e-9) : [];
  return (
    <ul className="gd-resists">
      {(["SLASH", "PIERCE", "BLUNT"] as const).map((d) => (
        <li key={d}>
          {DMG_LABEL[d]} {fmtX(resist[d])} · {resistTierName(resist[d])}
        </li>
      ))}
      {sins.map((s) => (
        <li key={s}>
          {SIN_LABEL[s]} {fmtX(sinResist![s])} · {resistTierName(sinResist![s])}
        </li>
      ))}
      {sinResist && !sins.length && <li>All sins ×1 · Normal</li>}
    </ul>
  );
}

const thresholds = (t: number[]) => (t.length ? t.map((x) => `${x}%`).join(" · ") : "none");

function StatsGrid({ x, level }: { x: Identity | Enemy | Part; level?: number }) {
  const e = x as Enemy;
  const lv = level ?? (x as Identity).level;
  const speed = x.speedMin !== null && x.speedMax !== null ? (x.speedMin === x.speedMax ? `${x.speedMin}` : `${x.speedMin}–${x.speedMax}`) : "Same as enemy";
  return (
    <div className="gd-stats">
      <Stat label={lv ? `HP at level ${lv}` : "HP"} value={x.hp} sub={x.hpPerLevel ? `+${x.hpPerLevel} per level` : undefined} />
      <Stat label="Speed" value={speed} />
      <Stat label="Defense Level" value={x.defenseMod >= 0 ? `+${x.defenseMod}` : x.defenseMod} sub="modifier" />
      <Stat label="Stagger thresholds" value={<span style={{ fontSize: "1rem" }}>{thresholds(x.staggerThresholds)}</span>} sub="of max HP" />
      {"breakable" in x && <Stat label="Part type" value={<span style={{ fontSize: "1rem" }}>{(x as Part).breakable}</span>} />}
      {e.hasSanity === false && <Stat label="Sanity" value="None" />}
    </div>
  );
}

function Skills({ list, level, title }: { list: Skill[]; level?: number; title: string }) {
  if (!list.length) return null;
  return (
    <div className="stack">
      {title && <h4 style={{ margin: 0 }}>{title}</h4>}
      {list.map((s) => (
        <SkillPreview key={s.id} s={s} level={level} />
      ))}
    </div>
  );
}

function reqText(p: Passive): string {
  if (p.reqMode === "res") return `Needs ${p.reqCount}+ ${SIN_LABEL[p.reqSin]} resonance`;
  if (p.reqMode === "owned") return `Needs ${p.reqCount}+ ${SIN_LABEL[p.reqSin]} owned`;
  return "No requirement";
}

function Passives({ list }: { list: Passive[] }) {
  if (!list.length) return null;
  return (
    <div className="stack">
      {list.map((p) => (
        <div key={p.id} className="gd-passive">
          <h4>
            {p.name} <span className="badge">{p.kind === "support" ? "Support" : "Combat"}</span>
          </h4>
          <p className="muted small">{reqText(p)}</p>
          <div className="preview" style={{ border: 0, padding: 0 }}>
            <EffectsPreview effects={p.effects} />
          </div>
          <GameNotes text={p.notes} />
        </div>
      ))}
    </div>
  );
}

function GiftEffects({ label, effects }: { label: string; effects: Effect[] | null }) {
  if (effects === null) return null;
  return (
    <div>
      <h4 style={{ margin: "0 0 4px" }}>{label}</h4>
      {effects.length ? (
        <div className="preview">
          <EffectsPreview effects={effects} />
        </div>
      ) : (
        <p className="muted small">No rules the simulator can use.</p>
      )}
    </div>
  );
}

function Body({ item }: { item: GameItem }) {
  switch (item.kind) {
    case "identity": {
      const x = item as Identity;
      return (
        <>
          <Card title="Key stats">
            <StatsGrid x={x} />
            <h4>Resistances</h4>
            <Resists resist={x.resist} />
            {x.traits.length > 0 && <p className="muted small">Traits: {x.traits.join(", ")}</p>}
          </Card>
          <Section id={`gd-skills`} title="Skills" summary={`${x.skills.length + x.defense.length}`}>
            <div className="stack">
              <Skills list={x.skills} level={x.level} title="Offense skills" />
              <Skills list={x.defense} level={x.level} title="Defense skills" />
            </div>
          </Section>
          {x.passives.length > 0 && (
            <Section id="gd-passives" title="Passives" summary={`${x.passives.length}`}>
              <Passives list={x.passives} />
            </Section>
          )}
        </>
      );
    }
    case "ego": {
      const x = item as Ego;
      const cost = SINS.filter((s) => x.cost[s] > 0).map((s) => `${x.cost[s]} ${SIN_LABEL[s]}`);
      return (
        <>
          <Card title="Key stats">
            <div className="gd-stats">
              <Stat label="Grade" value={<GradeBadge grade={x.grade} />} />
              <Stat label="Sin cost" value={<span style={{ fontSize: "1rem" }}>{cost.join(" · ") || "none"}</span>} />
              <Stat label="SP cost" value={x.spCost} />
            </div>
            <h4>Sin resistances while equipped</h4>
            <Resists resist={{ SLASH: 1, PIERCE: 1, BLUNT: 1 }} sinResist={x.sinResist} />
          </Card>
          <Section id="gd-skills" title="Skills">
            <div className="stack">
              <Skills list={[x.awakening]} title="Awakening" />
              {x.corrosion && <Skills list={[x.corrosion]} title="Corrosion" />}
            </div>
          </Section>
          {x.passive && (
            <Section id="gd-passives" title="Passive">
              <Passives list={[x.passive]} />
            </Section>
          )}
        </>
      );
    }
    case "enemy": {
      const x = item as Enemy;
      return (
        <>
          <Card title="Key stats">
            <StatsGrid x={x} level={x.level} />
            <h4>Resistances</h4>
            <Resists resist={x.resist} sinResist={x.sinResist} />
          </Card>
          {x.skills.length > 0 && (
            <Section id="gd-skills" title="Skills" summary={`${x.skills.length}`}>
              <div className="stack">
                <Skills list={x.skills} level={x.level} title="" />
              </div>
            </Section>
          )}
          {x.passives.length > 0 && (
            <Section id="gd-passives" title="Passives" summary={`${x.passives.length}`}>
              <Passives list={x.passives} />
            </Section>
          )}
          {x.parts.length > 0 && (
            <Section id="gd-parts" title="Parts" summary={`${x.parts.length}`}>
              {x.parts.map((p) => (
                <div key={p.id} className="gd-part">
                  <h4>{p.name}</h4>
                  <StatsGrid x={p} />
                  <h4 style={{ marginTop: 12 }}>Resistances</h4>
                  <Resists resist={p.resist} sinResist={p.sinResist} />
                  {p.skills.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <Skills list={p.skills} level={x.level} title="Skills" />
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}
        </>
      );
    }
    case "gift": {
      const x = item as Gift;
      return (
        <Card title="Effects">
          <div className="stack">
            <GiftEffects label="Base" effects={x.effects} />
            <GiftEffects label="+ (upgraded)" effects={x.plus1} />
            <GiftEffects label="++ (upgraded twice)" effects={x.plus2} />
          </div>
        </Card>
      );
    }
    default: {
      const x = item as CustomStatus;
      return (
        <Card title="Status">
          <p style={{ whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{x.description || "No description."}</p>
          <p className="muted small">
            {x.mode === "pc" ? "Tracks Potency + Count" : "Single value"} · key <span className="mono">{x.key}</span>
          </p>
          {x.effects.length > 0 && (
            <div className="preview">
              <EffectsPreview effects={x.effects} />
            </div>
          )}
        </Card>
      );
    }
  }
}

function subtitleBadges(item: GameItem) {
  if (item.kind === "ego") return <GradeBadge grade={(item as Ego).grade} />;
  if (item.kind === "gift") {
    const g = item as Gift;
    return (
      <>
        <span className="badge">{isNoTier(g) ? "No tier" : `Tier ${g.tier}`}</span>
        {isLegacy(g) && <span className="badge warn">Legacy</span>}
      </>
    );
  }
  return null;
}

export default function GameDataView({ kind, id }: { kind: GameKind; id: string }) {
  const info = KIND_INFO[kind];
  const { status, byId, error, retry } = useGameItems(kind);
  const statusState = useGameData((s) => s.kinds.status.status);
  const index = useGameData((s) => s.index);
  const upsert = useWorkspace((s) => s.upsert);
  const [busy, setBusy] = useState(false);
  const item = byId.get(id) as GameItem | undefined;

  if (status === "error")
    return (
      <Notice kind="error">
        <p style={{ margin: 0 }}>{error}</p>
        <div style={{ marginTop: 8 }}>
          <Button small onClick={retry}>Retry</Button>
        </div>
      </Notice>
    );
  if (status !== "ready") return <p className="muted" role="status">Loading game data…</p>;
  if (!item)
    return (
      <EmptyState title="Not found in the game data" action={<Button onClick={() => navigate(`/build/${info.slug}`)}>Back to the list</Button>}>
        This item isn't in the current game data snapshot.
      </EmptyState>
    );

  const copy = async () => {
    setBusy(true);
    await ensureGameData(["status"]);
    const made = copyToWorkshop(item);
    for (const m of made) upsert(m);
    setBusy(false);
    toast("Copied to your workshop — it's yours to edit");
    navigate(`/build/${info.slug}/${made[0].id}`);
  };

  const name = item.name || "Untitled";
  const page = item as unknown as { tags: string[]; notes: string };
  return (
    <div className="stack">
      <div className="card gd-head" style={{ padding: "12px 14px" }}>
        <div className="row">
          <Button className="show-on-narrow" icon="back" variant="ghost" onClick={() => navigate(`/build/${info.slug}`)}>
            All {info.plural.toLowerCase()}
          </Button>
          <h1 style={{ flex: 1, minWidth: 160 }}>{name}</h1>
          {subtitleBadges(item)}
        </div>
        <p className="muted small" style={{ margin: "6px 0 10px" }}>
          From the Limbus Company wiki ·{" "}
          <a href={wikiUrl(item)} target="_blank" rel="noopener noreferrer">
            Open the wiki page
          </a>
        </p>
        <div className="row">
          <Button variant="primary" icon="copy" disabled={busy} onClick={copy}>
            Copy to my workshop
          </Button>
          {(kind === "identity" || kind === "enemy") && (
            <Button icon="calc" onClick={() => navigate(`/calc?${kind === "identity" ? "attacker" : "defender"}=${kind}:${item.id}`)}>
              Test in calculator
            </Button>
          )}
        </div>
        {statusState === "error" && <p className="muted small">Game statuses could not be loaded, so the copy may be missing some.</p>}
        {page.tags.length > 0 && (
          <div className="gd-tags" style={{ marginTop: 10 }}>
            {page.tags.filter((t) => t !== "game data").map((t) => (
              <span key={t} className="badge">{t}</span>
            ))}
          </div>
        )}
      </div>
      <Body item={item} />
      {page.notes.trim() && (
        <Card title="Notes">
          <div className="stack">
            <GameNotes text={page.notes} />
          </div>
        </Card>
      )}
      {index && <p className="gd-foot">{index.attribution}</p>}
    </div>
  );
}
