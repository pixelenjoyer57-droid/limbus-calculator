// Display and accessibility preferences (shared by all workspaces on this device).
import { create } from "zustand";
import { readJSON, writeJSON } from "./storage";

export interface Settings {
  theme: "dark" | "light" | "system";
  contrast: "normal" | "high";
  textScale: number; // 0.9 .. 1.5
  motion: "system" | "reduce";
  font: "system" | "hyperlegible";
  spacing: "comfortable" | "compact";
  showHelp: boolean; // inline explanations under fields
}

const DEFAULTS: Settings = { theme: "dark", contrast: "normal", textScale: 1, motion: "system", font: "system", spacing: "comfortable", showHelp: true };

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  ...(readJSON<Partial<Settings>>("settings") ?? {}),
  update: (patch) => {
    set(patch);
    const { update: _u, ...rest } = get();
    void _u;
    writeJSON("settings", rest);
    applySettings(rest);
  },
}));

export function applySettings(s: Settings) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const theme = s.theme === "system" ? (prefersDark ? "dark" : "light") : s.theme;
  root.dataset.theme = theme;
  root.dataset.contrast = s.contrast;
  root.dataset.motion = s.motion;
  root.dataset.font = s.font;
  root.dataset.spacing = s.spacing;
  root.style.fontSize = `${Math.round(Math.max(0.85, Math.min(1.6, s.textScale)) * 100)}%`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#111015" : "#f6f3ee");
}
