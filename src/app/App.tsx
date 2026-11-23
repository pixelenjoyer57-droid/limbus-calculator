import { lazy, Suspense, useEffect, useRef } from "react";
import { navigate, useRoute, href } from "../lib/router";
import { useWorkspace } from "../store/workspace";
import { useSession } from "../store/session";
import { applySettings, useSettings } from "../store/settings";
import { requestPersistence } from "../store/storage";
import { Icon } from "../ui/icons";
import { Button } from "../ui/controls";
import { Notice, Toasts } from "../ui/layout";
import { Home } from "../features/home/Home";

const Library = lazy(() => import("../features/library/Library"));
const TeamPage = lazy(() => import("../features/team/TeamPage"));
const CalcPage = lazy(() => import("../features/calc/CalcPage"));
const SimPage = lazy(() => import("../features/sim/SimPage"));
const DataPage = lazy(() => import("../features/data/DataPage"));
const HelpPage = lazy(() => import("../features/help/HelpPage"));
const AboutPage = lazy(() => import("../features/about/AboutPage"));

const NAV = [
  { path: "/", label: "Home", icon: "home", short: "Home" },
  { path: "/build", label: "Builder", icon: "build", short: "Build" },
  { path: "/team", label: "Teams", icon: "team", short: "Teams" },
  { path: "/calc", label: "Damage calculator", icon: "calc", short: "Calc" },
  { path: "/sim", label: "Battle simulator", icon: "play", short: "Fight" },
];
const NAV_2 = [
  { path: "/data", label: "Save, share & settings", icon: "data" },
  { path: "/help", label: "How combat works", icon: "help" },
  { path: "/about", label: "About & credits", icon: "help" },
];

function isActive(current: string, path: string) {
  return path === "/" ? current === "/" : current === path || current.startsWith(path + "/");
}

function SaveIndicator() {
  const save = useWorkspace((s) => s.save);
  const text = save.status === "error" ? "Not saved" : save.status === "pending" ? "Saving…" : "Saved";
  return (
    <span className={`save-pill ${save.status === "error" ? "error" : ""}`} role="status" aria-live="polite" title={save.status === "error" ? "Browser storage is full or blocked. Export a backup." : "Everything saves automatically in this browser."}>
      <span className={`dot ${save.status === "pending" ? "pending" : save.status === "error" ? "error" : ""}`} aria-hidden />
      <span className="save-text">{text}</span>
    </span>
  );
}

function UndoRedo() {
  const canUndo = useWorkspace((s) => s.past.length > 0);
  const canRedo = useWorkspace((s) => s.future.length > 0);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  return (
    <>
      <Button icon="undo" variant="ghost" label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
      <Button icon="redo" variant="ghost" label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
    </>
  );
}

function titleFor(parts: string[]): string {
  const p = parts[0];
  if (!p) return "Home";
  if (p === "build") return "Builder";
  if (p === "team") return "Teams";
  if (p === "calc") return "Damage calculator";
  if (p === "sim") return "Battle simulator";
  if (p === "data") return "Save, share & settings";
  if (p === "help") return "How combat works";
  if (p === "about") return "About & credits";
  return "Sinner's Workshop";
}

export function App() {
  const ready = useWorkspace((s) => s.ready);
  const wsId = useWorkspace((s) => s.ws.id);
  const saveStatus = useWorkspace((s) => s.save.status);
  const { path, parts } = useRoute();
  const settings = useSettings();
  const loadedFor = useRef("");
  const restored = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    useWorkspace.getState().init();
    requestPersistence();
  }, []);

  useEffect(() => {
    applySettings(settings);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => applySettings(useSettings.getState());
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, [settings]);

  // Load the session of the active workspace, and resume the last screen once.
  useEffect(() => {
    if (!ready || loadedFor.current === wsId) return;
    loadedFor.current = wsId;
    useSession.getState().load(wsId);
    if (!restored.current) {
      restored.current = true;
      const last = useSession.getState().route;
      if ((window.location.hash === "" || window.location.hash === "#/") && last && last !== "#/") navigate(last.replace(/^#/, ""), true);
    }
  }, [ready, wsId]);

  useEffect(() => {
    if (!ready) return;
    useSession.getState().set({ route: "#" + path });
    document.title = `${titleFor(parts)} · Sinner's Workshop`;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (!(e.ctrlKey || e.metaKey) || typing) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        useWorkspace.getState().undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        useWorkspace.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="content">Loading…</div>;

  let page;
  switch (parts[0]) {
    case "build":
      page = <Library kindSlug={parts[1]} itemId={parts[2]} />;
      break;
    case "team":
      page = <TeamPage teamId={parts[1]} />;
      break;
    case "calc":
      page = <CalcPage />;
      break;
    case "sim":
      page = <SimPage />;
      break;
    case "data":
      page = <DataPage />;
      break;
    case "help":
      page = <HelpPage section={parts[1]} />;
      break;
    case "about":
      page = <AboutPage />;
      break;
    default:
      page = <Home />;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Main">
        <a className="brand" href={href("/")}>
          <span className="brand-mark" aria-hidden>SW</span>
          <span className="brand-text">
            <strong>Sinner's Workshop</strong>
            <span>Limbus custom kit lab</span>
          </span>
        </a>
        {NAV.map((n) => (
          <a key={n.path} className="nav-link" href={href(n.path)} aria-current={isActive(path, n.path) ? "page" : undefined}>
            <Icon name={n.icon} /> {n.label}
          </a>
        ))}
        <div className="nav-sep" />
        {NAV_2.map((n) => (
          <a key={n.path} className="nav-link" href={href(n.path)} aria-current={isActive(path, n.path) ? "page" : undefined}>
            <Icon name={n.icon} /> {n.label}
          </a>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <span className="title">{titleFor(parts)}</span>
          <SaveIndicator />
          <UndoRedo />
          <a className="btn ghost icon only-mobile" href={href("/data")} aria-label="Save, share & settings" title="Save, share & settings" style={{ display: "inline-flex" }}>
            <Icon name="gear" />
          </a>
          <a className="btn ghost icon" href={href("/help")} aria-label="How combat works" title="How combat works">
            <Icon name="help" />
          </a>
        </header>
        <main id="main" className="content" ref={mainRef} tabIndex={-1} style={{ outline: "none" }}>
          {saveStatus === "error" && (
            <div style={{ marginBottom: 16 }}>
              <Notice kind="error">
                <strong>Your browser refused to save.</strong> Storage may be full or blocked (private mode). Your work is still open — go to{" "}
                <a href={href("/data")}>Save &amp; share</a> and export a backup file now.
              </Notice>
            </div>
          )}
          <Suspense fallback={<p className="muted">Loading…</p>}>{page}</Suspense>
        </main>
      </div>
      <nav className="bottombar" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.path} href={href(n.path)} aria-current={isActive(path, n.path) ? "page" : undefined}>
            <Icon name={n.icon} />
            {n.short}
          </a>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
