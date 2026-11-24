import { useEffect, useState } from "react";
import { produce, type Draft } from "immer";
import { EGO_GRADES, SIN_LABEL, SINNERS, SINS, type Sinner } from "../../engine/constants";
import type { Team, TeamMember } from "../../data/schema";
import { newTeam } from "../../data/defaults";
import { duplicateItem } from "../../data/migrate";
import { useWorkspace } from "../../store/workspace";
import { useSession } from "../../store/session";
import { toast } from "../../store/toast";
import { href, navigate } from "../../lib/router";
import { Button, Check, NumberInput, TextInput } from "../../ui/controls";
import { EmptyState, Section } from "../../ui/layout";
import { Icon } from "../../ui/icons";
import { ContentPicker, useResolvedItem } from "../../ui/ContentPicker";
import type { Ego, Identity } from "../../data/schema";
import { GiftsSection } from "./GiftsSection";

const emptyMember = (): TeamMember => ({ identityId: null, level: 65, uptie: 4, egos: { ZAYIN: null, TETH: null, HE: null, WAW: null, ALEPH: null } });

function MemberCard({ team, sinner, edit }: { team: Team; sinner: Sinner; edit: (fn: (d: Draft<Team>) => void, key?: string) => void }) {
  const m = team.members[sinner] ?? emptyMember();
  const deployed = team.deploy.includes(sinner);
  const order = team.deploy.indexOf(sinner);
  const [open, setOpen] = useState(false);
  const set = (fn: (d: Draft<TeamMember>) => void, key?: string) =>
    edit((d) => {
      if (!d.members[sinner]) d.members[sinner] = emptyMember();
      fn(d.members[sinner]!);
    }, key);
  const idn = useResolvedItem("identity", m.identityId).item;
  return (
    <div className="unit" style={{ borderColor: deployed ? "var(--gold)" : undefined }}>
      <div className="row">
        <strong style={{ flex: 1 }}>{sinner}</strong>
        {deployed && <span className="badge gold">#{order + 1} deployed</span>}
      </div>
      <ContentPicker
        kind="identity"
        label="Identity"
        value={m.identityId}
        allowNone
        noneLabel="— none —"
        filter={(i: Identity) => i.sinner === sinner}
        onChange={(v) =>
          edit((d) => {
            if (!d.members[sinner]) d.members[sinner] = emptyMember();
            d.members[sinner]!.identityId = v || null;
            if (v && !d.deploy.includes(sinner) && d.deploy.length < 12) d.deploy.push(sinner);
            if (!v) d.deploy = d.deploy.filter((s) => s !== sinner);
          })
        }
      />
      {idn && (
        <>
          <Check
            label="Deploy in fights"
            checked={deployed}
            onChange={(on) =>
              edit((d) => {
                d.deploy = on ? [...d.deploy.filter((s) => s !== sinner), sinner] : d.deploy.filter((s) => s !== sinner);
              })
            }
            hint={deployed ? undefined : "Benched members still give their Support passive."}
          />
          <button type="button" className="btn ghost small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Level, Uptie & E.G.O"} · Lv {m.level} · Uptie {m.uptie}
          </button>
          {open && (
            <div className="fields" style={{ marginTop: 8 }}>
              <NumberInput label="Level" value={m.level} onChange={(n) => set((d) => void (d.level = n), "lvl" + sinner)} min={1} max={200} />
              <NumberInput label="Uptie" value={m.uptie} onChange={(n) => set((d) => void (d.uptie = n))} min={1} max={4} hint="S3 at 3, Combat passive at 2, Support at 3" />
              {EGO_GRADES.map((g) => (
                <ContentPicker
                  key={g}
                  kind="ego"
                  label={`${g} E.G.O`}
                  value={m.egos[g] ?? null}
                  allowNone
                  noneLabel="— none —"
                  filter={(e: Ego) => e.sinner === sinner && e.grade === g}
                  onChange={(v) => set((d) => void (d.egos[g] = v || null))}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamEditor({ team }: { team: Team }) {
  const upsert = useWorkspace((s) => s.upsert);
  const [showAll, setShowAll] = useState(false);
  const edit = (fn: (d: Draft<Team>) => void, key?: string) => {
    const next = produce(team, fn);
    if (next !== team) upsert(next, key ? `${team.id}:${key}` : undefined);
  };
  const withIdentity = SINNERS.filter((s) => team.members[s]?.identityId);
  const visible = showAll ? SINNERS : withIdentity.length ? withIdentity : SINNERS;
  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <div style={{ flex: 1, minWidth: 200 }}>
            <TextInput label="Team name" value={team.name} onChange={(v) => edit((d) => void (d.name = v), "name")} />
          </div>
          <Button variant="primary" icon="swords" onClick={() => navigate(`/sim?team=${team.id}`)}>
            Fight with this team
          </Button>
        </div>
      </div>

      <Section id="team-members" title="Sinners" summary={`${team.deploy.length} deployed`}>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted small" style={{ flex: 1 }}>Pick an Identity for each Sinner you want to use: one you built, or any Identity from the game (the picker has both).</span>
          <Button small onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show only used Sinners" : "Show all 12 Sinners"}
          </Button>
        </div>
        <div className="units">
          {visible.map((s) => (
            <MemberCard key={s} team={team} sinner={s} edit={edit} />
          ))}
        </div>
      </Section>

      <Section id="team-order" title="Deployment order" summary={team.deploy.join(" → ") || "nobody"}>
        {!team.deploy.length && <p className="muted">Nobody is deployed yet.</p>}
        <p className="small muted">The first Sinners gain extra Skill Slots first (from turn 2) and win Speed ties.</p>
        <ol style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
          {team.deploy.map((s, i) => (
            <li key={s} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <span className="badge">{i + 1}</span>
              <span style={{ flex: 1 }}>{s}</span>
              <Button icon="up" small variant="ghost" label={`Move ${s} up`} disabled={i === 0} onClick={() => edit((d) => void d.deploy.splice(i - 1, 0, d.deploy.splice(i, 1)[0]))} />
              <Button icon="down" small variant="ghost" label={`Move ${s} down`} disabled={i === team.deploy.length - 1} onClick={() => edit((d) => void d.deploy.splice(i + 1, 0, d.deploy.splice(i, 1)[0]))} />
            </li>
          ))}
        </ol>
      </Section>

      <Section id="team-gifts" title="E.G.O Gifts" summary={`${team.gifts.length} gift${team.gifts.length === 1 ? "" : "s"}`}>
        <GiftsSection team={team} edit={edit} />
      </Section>

      <Section id="team-res" title="Starting E.G.O resources" defaultOpen={false} summary={SINS.filter((s) => team.startResources[s]).map((s) => `${SIN_LABEL[s]} ${team.startResources[s]}`).join(", ") || "none"}>
        <div className="fields">
          {SINS.map((s) => (
            <NumberInput key={s} label={SIN_LABEL[s]} value={team.startResources[s]} onChange={(n) => edit((d) => void (d.startResources[s] = n), "res" + s)} min={0} max={99} />
          ))}
        </div>
        <p className="small muted">Useful to test E.G.O or "Owned" passives from turn 1 (Mirror Dungeons keep resources between fights).</p>
      </Section>
    </div>
  );
}

export default function TeamPage({ teamId }: { teamId?: string }) {
  const teams = useWorkspace((s) => s.ws.teams);
  const upsert = useWorkspace((s) => s.upsert);
  const remove = useWorkspace((s) => s.remove);
  const touch = useSession((s) => s.touch);
  const team = teams.find((t) => t.id === teamId) ?? (teamId ? undefined : teams[0]);
  useEffect(() => {
    if (team) touch("team", team.id);
  }, [team?.id, touch]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = () => {
    const t = newTeam({ name: `Team ${teams.length + 1}` });
    upsert(t);
    navigate(`/team/${t.id}`);
  };
  return (
    <div className="split">
      <div className={`sticky-side ${teamId ? "hide-on-narrow" : ""}`}>
        <div className="stack">
          <Button variant="primary" icon="plus" onClick={create}>
            New team
          </Button>
          <div className="list">
            {teams.map((t) => (
              <a key={t.id} className="list-item" href={href(`/team/${t.id}`)} aria-current={t.id === team?.id ? "true" : undefined} style={{ textDecoration: "none" }}>
                <Icon name="team" />
                <span className="li-main">
                  <span className="li-name">{t.name}</span>
                  <span className="li-sub">{t.deploy.length} deployed · {t.gifts.length} gifts</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
      <div>
        {team ? (
          <div className="stack">
            <div className="row">
              <Button className="show-on-narrow" icon="back" variant="ghost" onClick={() => navigate("/team")}>
                All teams
              </Button>
              <span className="spacer" />
              <Button small icon="copy" onClick={() => { const c = duplicateItem(team); upsert(c); navigate(`/team/${c.id}`); }}>
                Duplicate
              </Button>
              <Button
                small
                icon="trash"
                variant="danger"
                onClick={() => {
                  remove("team", team.id);
                  navigate("/team");
                  toast(`Deleted "${team.name}".`, "info", { label: "Undo", run: () => useWorkspace.getState().undo() });
                }}
              >
                Delete
              </Button>
            </div>
            <TeamEditor team={team} />
          </div>
        ) : (
          <EmptyState title="No team yet" action={<Button variant="primary" icon="plus" onClick={create}>Make a team</Button>}>
            Teams decide which Identities, E.G.O and gifts go into a fight.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
