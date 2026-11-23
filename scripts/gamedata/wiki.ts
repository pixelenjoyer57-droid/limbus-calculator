// Minimal, polite client for the Limbus Company wiki's MediaWiki API.
// Sequential requests, 50 pages per call, a short pause between calls, and a
// local cache so re-running the importer does not hit the wiki again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const WIKI = "https://limbuscompany.wiki.gg";
const API = `${WIKI}/api.php`;
const UA = "SinnersWorkshop-GameDataImporter/1.0 (fan-made Limbus Company simulator; batch reader)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params })}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.error?.code === "maxlag") throw new Error("maxlag");
      if (data?.error) throw new Error(`API error: ${data.error.code} ${data.error.info}`);
      await sleep(350);
      return data;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
}

/** All page titles in a category (namespace 0 by default; follows continuation). */
export async function categoryPages(category: string, namespace = "0"): Promise<string[]> {
  const out: string[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const d = await api({ action: "query", list: "categorymembers", cmtitle: category, cmlimit: "500", cmnamespace: namespace, ...cont });
    for (const m of d.query.categorymembers) out.push(m.title);
    if (!d.continue) break;
    cont = d.continue;
  }
  return out;
}

export interface PageText {
  title: string;
  text: string;
  revid: number;
  timestamp: string;
}

/** Wikitext of many pages, 50 per request. Missing pages are skipped. */
export async function pageTexts(titles: string[], cacheDir?: string, offline = false): Promise<PageText[]> {
  const out: PageText[] = [];
  const todo: string[] = [];
  const cacheFile = (t: string) => join(cacheDir!, encodeURIComponent(t).replace(/%/g, "_") + ".json");
  for (const t of titles) {
    if (cacheDir && existsSync(cacheFile(t))) out.push(JSON.parse(readFileSync(cacheFile(t), "utf8")));
    else todo.push(t);
  }
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  if (offline) {
    if (todo.length) console.warn(`  offline: ${todo.length} pages are not cached and were skipped`);
    return out;
  }
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const d = await api({ action: "query", prop: "revisions", rvprop: "content|ids|timestamp", rvslots: "main", titles: batch.join("|") });
    for (const p of d.query.pages ?? []) {
      const rev = p.revisions?.[0];
      if (!rev) continue;
      const page: PageText = { title: p.title, text: rev.slots?.main?.content ?? "", revid: rev.revid, timestamp: rev.timestamp };
      out.push(page);
      if (cacheDir) writeFileSync(cacheFile(p.title), JSON.stringify(page));
    }
    process.stdout.write(`  fetched ${Math.min(i + 50, todo.length)}/${todo.length}\r`);
  }
  if (todo.length) process.stdout.write("\n");
  return out;
}
