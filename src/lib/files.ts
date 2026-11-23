// File and clipboard helpers for export / import / sharing between devices.
import { toast } from "../store/toast";

export function downloadJSON(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^\w.\- ]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function pickFile(accept = "application/json,.json,.txt"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    input.click();
  });
}

export async function copyText(text: string, what = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to the clipboard.`);
    return true;
  } catch {
    // fallback for older browsers / insecure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    toast(ok ? `${what} to the clipboard.` : "Couldn't copy automatically — select the text and copy it.", ok ? "ok" : "error");
    return ok;
  }
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "item";
}

export function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
