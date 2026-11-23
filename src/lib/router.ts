// Hash router: #/path/segments. Works on GitHub Pages without server rewrites.
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

const getHash = () => window.location.hash || "#/";

export function useRoute(): { path: string; parts: string[] } {
  const hash = useSyncExternalStore(subscribe, getHash, () => "#/");
  const path = hash.replace(/^#/, "").split("?")[0] || "/";
  return { path, parts: path.split("/").filter(Boolean) };
}

export function navigate(path: string, replace = false) {
  const hash = "#" + (path.startsWith("/") ? path : "/" + path);
  if (replace) window.history.replaceState(null, "", hash);
  else window.location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export const href = (path: string) => "#" + (path.startsWith("/") ? path : "/" + path);
