import { href, navigate } from "../../lib/router";
import { useWorkspace } from "../../store/workspace";
import { useSession } from "../../store/session";
import { COLLECTION, type ContentKind } from "../../data/schema";
import { Icon } from "../../ui/icons";
import { Button } from "../../ui/controls";
import { Card, Notice } from "../../ui/layout";
import { KIND_INFO } from "../library/kinds";
import { useGameData } from "../../gamedata";
import { useEffect } from "react";

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function Home() {
  const ws = useWorkspace((s) => s.ws);
  const firstRun = useWorkspace((s) => s.firstRun);
  const lastExportAt = useWorkspace((s) => s.lastExportAt);
  const recent = useSession((s) => s.recent);
  const dismissed = useSession((s) => s.dismissed);
  const setSession = useSession((s) => s.set);
  const create = useWorkspace((s) => s.create);
  const gameIndex = useGameData((s) => s.index);
  const ensureIndex = useGameData((s) => s.ensureIndex);
  const open = useSession((s) => s.open);
  useEffect(() => void ensureIndex(), [ensureIndex]);
  const c = gameIndex?.counts;
  const browseGame = () => {
    setSession({ open: { ...open, "lib.game.identity": true } });
    navigate("/build/identities");
  };

  const recentItems = recent
    .map((r) => {
      const arr = ws[COLLECTION[r.kind]] as unknown as { id: string; name: string }[];
      const item = arr.find((x) => x.id === r.id);
      return item ? { ...r, name: item.name } : null;
    })
    .filter(Boolean) as { kind: ContentKind; id: string; at: number; name: string }[];
  const last = recentItems[0];
  const needsBackup = ws.updatedAt > lastExportAt + 1000 && Date.now() - Math.max(lastExportAt, ws.createdAt) > 7 * 86400000;

  return (
    <div className="stack">
      <div className="hero">
        <p className="muted" style={{ margin: 0, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: "0.78rem" }}>
          Workshop: {ws.name}
        </p>
        <h1>Build it. Test it. Fight it.</h1>
        <p className="muted" style={{ maxWidth: 640 }}>
          Make custom Identities, E.G.O, enemies, encounters, events and E.G.O Gifts, then check them with the same damage formula the game uses.
          Everything saves by itself.
        </p>
        <div className="row">
          {last ? (
            <Button variant="primary" icon="play" onClick={() => navigate(`/build/${KIND_INFO[last.kind].slug}/${last.id}`)}>
              Continue: {last.name}
            </Button>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => navigate("/build/identities?new=1")}>
              Make your first Identity
            </Button>
          )}
          <Button icon="calc" onClick={() => navigate("/calc")}>
            Damage calculator
          </Button>
          <Button icon="swords" onClick={() => navigate("/sim")}>
            Battle simulator
          </Button>
        </div>
      </div>

      {firstRun && !dismissed.examples && (
        <Notice kind="info" onClose={() => setSession({ dismissed: { ...dismissed, examples: true } })}>
          <strong>This workshop has example content</strong> (four example Identities, enemies, a gift and an event) so you can try every screen.
          Keep it, edit it, or start clean.
          <div className="row" style={{ marginTop: 8 }}>
            <Button small onClick={() => { create("My Workshop", "empty"); setSession({ dismissed: { ...dismissed, examples: true } }); }}>
              Start an empty workshop
            </Button>
            <span className="small muted">The examples stay in their own workshop; switch any time in Save &amp; share.</span>
          </div>
        </Notice>
      )}

      {needsBackup && !dismissed["backup-" + Math.floor(Date.now() / (7 * 86400000))] && (
        <Notice kind="warn" onClose={() => setSession({ dismissed: { ...dismissed, ["backup-" + Math.floor(Date.now() / (7 * 86400000))]: true } })}>
          <strong>Time for a backup?</strong> Your work lives in this browser. A backup file (or a share code) lets you move it to another device and keeps it safe.{" "}
          <a href={href("/data")}>Export a backup</a>
        </Notice>
      )}

      <Card title="Quick start">
        <ol className="muted" style={{ margin: 0, paddingLeft: "1.2em" }}>
          <li>
            <strong style={{ color: "var(--text)" }}>Build</strong> an Identity or enemy — start from a template so you never face a blank page.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Calculate</strong> one Clash or attack and see every step of the damage math.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Simulate</strong> a whole fight turn by turn, or run it hundreds of times for win rates.
          </li>
        </ol>
      </Card>

      <div className="quick" aria-label="Your content">
        {(Object.keys(KIND_INFO) as ContentKind[])
          .filter((k) => k !== "team")
          .map((k) => {
            const info = KIND_INFO[k];
            const n = (ws[COLLECTION[k]] as unknown[]).length;
            return (
              <a key={k} href={href(`/build/${info.slug}`)}>
                <Icon name={info.icon} size={26} />
                <span>
                  <strong>{info.plural}</strong>
                  <span>
                    {n} saved · {info.blurb}
                  </span>
                </span>
              </a>
            );
          })}
        <a href={href("/team")}>
          <Icon name="team" size={26} />
          <span>
            <strong>Teams</strong>
            <span>{ws.teams.length} saved · loadouts for fights</span>
          </span>
        </a>
      </div>

      <Card title="From the game">
        <p className="muted" style={{ marginTop: 0 }}>
          {c ? `${c.identities} Identities · ${c.egos} E.G.O · ${c.enemies} enemies · ${c.gifts} E.G.O Gifts` : "Identities, E.G.O, enemies and E.G.O Gifts"} from the game are ready to use. Pick them in the calculator, teams, encounters and the simulator, or copy one to edit it.
        </p>
        <Button icon="search" onClick={browseGame}>Browse game content</Button>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Data from the <a href="https://limbuscompany.wiki.gg" target="_blank" rel="noreferrer">Limbus Company Wiki</a> (CC BY-SA 4.0). Limbus Company belongs to Project Moon.
        </p>
      </Card>

      {recentItems.length > 0 && (
        <Card title="Continue where you left off">
          <div className="list">
            {recentItems.slice(0, 6).map((r) => (
              <a key={r.kind + r.id} className="list-item" href={href(r.kind === "team" ? `/team/${r.id}` : `/build/${KIND_INFO[r.kind].slug}/${r.id}`)} style={{ textDecoration: "none" }}>
                <Icon name={KIND_INFO[r.kind].icon} />
                <span className="li-main">
                  <span className="li-name">{r.name}</span>
                  <span className="li-sub">
                    {KIND_INFO[r.kind].label} · opened {ago(r.at)}
                  </span>
                </span>
                <Icon name="chevron" />
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
