import { useEffect, useState } from "react";
import { useWorkspace } from "../../store/workspace";
import { useSettings } from "../../store/settings";
import { toast } from "../../store/toast";
import { bytesOf, requestPersistence, storageEstimate } from "../../store/storage";
import { countItems, encodeShareCode, importAny, mergeItems, type ImportResult } from "../../data/migrate";
import { copyText, dateStamp, downloadJSON, pickFile, slug } from "../../lib/files";
import { Button, Check, NumberInput, Segmented, TextInput } from "../../ui/controls";
import { Card, Dialog, Notice, Section } from "../../ui/layout";

function kb(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function Workspaces() {
  const index = useWorkspace((s) => s.index);
  const ws = useWorkspace((s) => s.ws);
  const { switchTo, create, rename, deleteWorkspace } = useWorkspace.getState();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const target = index.list.find((m) => m.id === confirm);
  return (
    <Section id="data-ws" title="Workshops" summary={`${index.list.length} workshop${index.list.length === 1 ? "" : "s"} · open: ${ws.name}`}>
      <p className="small muted">A workshop is a separate save slot with its own content and its own "where was I" state. Switch freely — nothing is lost.</p>
      <div className="fields">
        <TextInput label="Name of the open workshop" className="span-2" value={ws.name} onChange={rename} />
      </div>
      <div className="list" style={{ marginTop: 10 }}>
        {index.list.map((m) => (
          <div key={m.id} className="list-item" aria-current={m.id === ws.id ? "true" : undefined} style={{ cursor: "default" }}>
            <span className="li-main">
              <span className="li-name">{m.name}</span>
              <span className="li-sub">
                {m.count} items · edited {new Date(m.updatedAt || Date.now()).toLocaleString()}
              </span>
            </span>
            {m.id === ws.id ? (
              <span className="badge gold">Open</span>
            ) : (
              <Button small onClick={() => { switchTo(m.id); toast(`Opened "${m.name}".`); }}>
                Open
              </Button>
            )}
            <Button small icon="trash" variant="ghost" label={`Delete ${m.name}`} onClick={() => setConfirm(m.id)} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <TextInput label="New workshop name" value={newName} onChange={setNewName} placeholder="e.g. Canto ideas" />
        </div>
        <Button icon="plus" onClick={() => { create(newName || "New Workshop", "empty"); setNewName(""); toast("Created an empty workshop."); }}>
          Empty
        </Button>
        <Button icon="copy" onClick={() => { create(newName || `${ws.name} (copy)`, "copy"); setNewName(""); toast("Copied this workshop."); }}>
          Copy of this one
        </Button>
        <Button onClick={() => { create(newName || "Example Workshop", "sample"); setNewName(""); toast("Created a workshop with the examples."); }}>
          With examples
        </Button>
      </div>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this workshop?"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="primary" onClick={() => { if (confirm) deleteWorkspace(confirm); setConfirm(null); toast("Workshop deleted."); }}>
              Delete forever
            </Button>
          </>
        }
      >
        <p>
          <strong>{target?.name}</strong> and its {target?.count ?? 0} items will be removed from this browser. This can't be undone — export a backup first if you might want it back.
        </p>
      </Dialog>
    </Section>
  );
}

function BackupAndImport() {
  const ws = useWorkspace((s) => s.ws);
  const markExported = useWorkspace((s) => s.markExported);
  const lastExportAt = useWorkspace((s) => s.lastExportAt);
  const [paste, setPaste] = useState("");
  const [pending, setPending] = useState<ImportResult | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const size = bytesOf(ws);

  const handle = (text: string | null) => {
    if (!text) return;
    const r = importAny(text);
    if (r.source === "unknown") toast(r.message, "error");
    else setPending(r);
  };
  const apply = (mode: "merge" | "new") => {
    if (!pending) return;
    const st = useWorkspace.getState();
    if (pending.workspace) {
      if (mode === "new") {
        st.adopt(pending.workspace);
        toast(`Opened imported workshop "${pending.workspace.name}".`);
      } else {
        const all = [...pending.workspace.identities, ...pending.workspace.egos, ...pending.workspace.enemies, ...pending.workspace.encounters, ...pending.workspace.events, ...pending.workspace.gifts, ...pending.workspace.statuses, ...pending.workspace.teams];
        const { workspace, added, replaced } = mergeItems(st.ws, all);
        st.edit((d) => Object.assign(d, { ...workspace, id: d.id, name: d.name }));
        toast(`Added ${added}, updated ${replaced} item(s).`, "ok", { label: "Undo", run: () => useWorkspace.getState().undo() });
      }
    } else {
      const { workspace, added, replaced } = mergeItems(st.ws, pending.items);
      st.edit((d) => Object.assign(d, { ...workspace, id: d.id, name: d.name }));
      toast(`Added ${added}, updated ${replaced} item(s).`, "ok", { label: "Undo", run: () => useWorkspace.getState().undo() });
    }
    setPending(null);
    setPaste("");
  };
  return (
    <Section id="data-backup" title="Backup, move & import" summary={lastExportAt ? `last backup ${new Date(lastExportAt).toLocaleDateString()}` : "no backup yet"}>
      <div className="grid two">
        <div>
          <h4>Back up / move to another device</h4>
          <p className="small muted">
            Your work is saved in this browser on this device ({kb(size)}). To use it on your phone or another computer, export a file or copy a share code and import it there.
          </p>
          <div className="row">
            <Button variant="gold" icon="download" onClick={() => { downloadJSON(`${slug(ws.name)}-${dateStamp()}.workshop.json`, ws); markExported(); toast("Backup file downloaded."); }}>
              Download backup file
            </Button>
            <Button icon="share" onClick={() => { setCode(encodeShareCode(ws)); markExported(); }}>
              Get share code
            </Button>
          </div>
        </div>
        <div>
          <h4>Import</h4>
          <p className="small muted">Backup files, single-item exports, share codes, and files from the original one-page Sinner's Workshop all work.</p>
          <div className="row">
            <Button icon="upload" onClick={async () => handle(await pickFile())}>
              Choose a file
            </Button>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label className="label" htmlFor="paste-code">
              …or paste a share code / JSON
            </label>
            <textarea id="paste-code" className="input mono" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </div>
          <Button small disabled={!paste.trim()} onClick={() => handle(paste)}>
            Read pasted text
          </Button>
        </div>
      </div>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Import"
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            {pending?.workspace && (
              <Button onClick={() => apply("new")} icon="plus">
                Open as a new workshop
              </Button>
            )}
            <Button variant="primary" onClick={() => apply("merge")}>
              Add to "{ws.name}"
            </Button>
          </>
        }
      >
        <p>{pending?.message}</p>
        {pending?.workspace && <p className="small muted">It contains {countItems(pending.workspace)} items. Adding them keeps everything you already have (items with the same id are updated).</p>}
        {pending && !pending.workspace && (
          <ul>
            {pending.items.slice(0, 12).map((it) => (
              <li key={it.id}>
                {(it as { name?: string }).name ?? it.id} <span className="muted small">({it.kind})</span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <Dialog
        open={!!code}
        onClose={() => setCode(null)}
        title="Share code for this workshop"
        footer={
          <>
            <Button onClick={() => setCode(null)}>Close</Button>
            <Button variant="gold" icon="copy" onClick={() => code && copyText(code, "Share code copied")}>
              Copy
            </Button>
          </>
        }
      >
        <p className="small">
          {code && code.length > 60000 ? "This code is long; a backup file may be easier for big workshops." : "Paste this into Import on the other device (send it to yourself in a chat or note)."} ({kb(code?.length ?? 0)})
        </p>
        <textarea className="input mono" readOnly rows={7} value={code ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="Share code" />
      </Dialog>
    </Section>
  );
}

function StorageInfo() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    storageEstimate().then(setEst);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  return (
    <Section id="data-storage" title="Storage on this device" defaultOpen={false} summary={persisted ? "protected" : "standard"}>
      <ul className="small" style={{ margin: 0, paddingLeft: "1.2em" }}>
        <li>Everything saves automatically (look for "Saved" at the top).</li>
        <li>{est ? `Using ${kb(est.usage)} of about ${kb(est.quota)}.` : "Storage size is unknown in this browser."}</li>
        <li>
          {persisted ? "This browser promised to keep the data." : "The browser may clear data if the device runs low on space."}{" "}
          {!persisted && (
            <Button small onClick={async () => { const ok = await requestPersistence(); setPersisted(ok); toast(ok ? "Storage is now protected." : "The browser declined; keep backups.", ok ? "ok" : "info"); }}>
              Ask to keep it
            </Button>
          )}
        </li>
        <li>On iPhone/iPad, Safari can wipe site data after 7 days without a visit. Add this page to your Home Screen (Share → Add to Home Screen) to avoid that, and keep a backup.</li>
        <li>Private / incognito windows forget everything when closed.</li>
      </ul>
    </Section>
  );
}

function Accessibility() {
  const s = useSettings();
  return (
    <Section id="data-a11y" title="Display & accessibility" summary={`${s.theme} · text ${Math.round(s.textScale * 100)}%`}>
      <div className="fields wide">
        <Segmented label="Theme" value={s.theme} onChange={(v) => s.update({ theme: v })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "Match device" }]} />
        <Segmented label="Contrast" value={s.contrast} onChange={(v) => s.update({ contrast: v })} options={[{ value: "normal", label: "Normal" }, { value: "high", label: "High" }]} />
        <NumberInput label="Text size (%)" value={Math.round(s.textScale * 100)} onChange={(n) => s.update({ textScale: n / 100 })} min={85} max={160} step={5} />
        <Segmented label="Font" value={s.font} onChange={(v) => s.update({ font: v })} options={[{ value: "system", label: "Device font" }, { value: "hyperlegible", label: "Extra readable" }]} />
        <Segmented label="Spacing" value={s.spacing} onChange={(v) => s.update({ spacing: v })} options={[{ value: "comfortable", label: "Roomy" }, { value: "compact", label: "Compact" }]} />
        <Segmented label="Animations" value={s.motion} onChange={(v) => s.update({ motion: v })} options={[{ value: "system", label: "Follow device" }, { value: "reduce", label: "Off" }]} />
        <Check label="Show hints under fields" checked={s.showHelp} onChange={(v) => s.update({ showHelp: v })} hint="Turn off for a calmer screen once you know your way around." />
      </div>
      <p className="small muted">Keyboard: Tab moves between controls, Ctrl+Z / Ctrl+Shift+Z undo and redo (outside text boxes), Escape closes dialogs.</p>
    </Section>
  );
}

export default function DataPage() {
  const saveStatus = useWorkspace((s) => s.save.status);
  return (
    <div className="stack">
      {saveStatus === "error" && <Notice kind="error">Saving failed in this browser. Download a backup file below right away.</Notice>}
      <BackupAndImport />
      <Workspaces />
      <Accessibility />
      <StorageInfo />
      <Card title="About">
        <p className="small muted">
          Sinner's Workshop is a fan-made tool for testing custom Limbus Company content. Mechanics and formulas follow the community wiki at{" "}
          <a href="https://limbuscompany.wiki.gg/wiki/Damage_Formula" target="_blank" rel="noopener noreferrer">
            limbuscompany.wiki.gg
          </a>
          . It is not affiliated with Project Moon.
        </p>
      </Card>
    </div>
  );
}
