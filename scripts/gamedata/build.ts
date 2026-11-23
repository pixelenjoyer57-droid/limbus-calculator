// Game data importer: reads the Limbus Company wiki and writes public/gamedata/*.json.
//
//   npm run gamedata                 # fetch from the wiki (cached in .cache/wiki)
//   npm run gamedata -- --offline    # only use the cache
//
// Wiki content is CC BY-SA 4.0 (limbuscompany.wiki.gg); the generated files keep
// the attribution in index.json and every item's `source` field.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { categoryPages, pageTexts, WIKI, type PageText } from "./wiki";
import { parseLuaTable } from "./lua";
import { StatusRegistry } from "./statuses";
import { allStatuses, Ctx, finishEnemies, giftSections, mapEgo, mapEnemyPage, mapGifts, mapIdentity } from "./mappers";
import type { Ego, Identity } from "../../src/data/schema";
import { compactEgo, compactEnemy, compactGiftDeep, compactIdentity, compactStatus } from "./compact";

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const cacheArg = args.indexOf("--cache");
const CACHE = cacheArg >= 0 ? args[cacheArg + 1] : join(process.cwd(), ".cache", "wiki");
const OUT = join(process.cwd(), "public", "gamedata");

const CATEGORIES = {
  identities: "Category:Identity ID",
  egos: "Category:E.G.O ID",
  enemies: ["Category:Enemy", "Category:Boss Enemy"],
};
const MODULES = { gifts: "Module:EgoGift/data", statuses: "Module:StatusEffect/data" };

async function main() {
  const t0 = Date.now();
  let idTitles: string[];
  let egoTitles: string[];
  let enemyTitles: string[];
  const catFile = join(CACHE, "_categories.json");
  if (offline) {
    const c = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(catFile, "utf8")));
    ({ idTitles, egoTitles, enemyTitles } = c);
  } else {
    console.log("Listing categories…");
    idTitles = await categoryPages(CATEGORIES.identities);
    egoTitles = await categoryPages(CATEGORIES.egos);
    enemyTitles = [...new Set((await Promise.all(CATEGORIES.enemies.map((c) => categoryPages(c)))).flat())];
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(catFile, JSON.stringify({ idTitles, egoTitles, enemyTitles }));
  }
  // translated copies (".../es") are skipped
  enemyTitles = enemyTitles.filter((t) => !/\/(es|ko|ja|zh|fr|de|pt|ru)$/i.test(t));
  console.log(`Pages: ${idTitles.length} Identities, ${egoTitles.length} E.G.O, ${enemyTitles.length} enemy pages`);

  const all = [...idTitles, ...egoTitles, ...enemyTitles, MODULES.gifts, MODULES.statuses];
  const pages = await pageTexts(all, CACHE, offline);
  const byTitle = new Map<string, PageText>(pages.map((p) => [p.title, p]));
  const need = (t: string) => {
    const p = byTitle.get(t);
    if (!p) throw new Error(`Missing page ${t}`);
    return p.text;
  };

  const statusData = parseLuaTable(need(MODULES.statuses));
  const reg = new StatusRegistry(statusData);
  const ctx = new Ctx(reg);

  const identities: Identity[] = [];
  const skipped: string[] = [];
  for (const t of idTitles) {
    const p = byTitle.get(t);
    const x = p ? mapIdentity(t, p.text, ctx) : null;
    if (x) identities.push(x);
    else skipped.push(`identity: ${t}`);
  }
  const egos: Ego[] = [];
  for (const t of egoTitles) {
    const p = byTitle.get(t);
    const x = p ? mapEgo(t, p.text, ctx) : null;
    if (x) egos.push(x);
    else skipped.push(`ego: ${t}`);
  }
  const enemyVariants = [];
  for (const t of enemyTitles) {
    const p = byTitle.get(t);
    if (!p) continue;
    const list = mapEnemyPage(t, p.text, ctx);
    if (!list.length) skipped.push(`enemy: ${t}`);
    enemyVariants.push(...list);
  }
  const enemies = finishEnemies(enemyVariants);
  const gifts = mapGifts(parseLuaTable(need(MODULES.gifts)), ctx, giftSections(need(MODULES.gifts)));
  const statuses = allStatuses(statusData, reg);

  const sortByName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  identities.sort((a, b) => a.sinner.localeCompare(b.sinner) || sortByName(a, b));
  egos.sort((a, b) => a.sinner.localeCompare(b.sinner) || sortByName(a, b));
  enemies.sort(sortByName);
  gifts.sort(sortByName);

  const latest = pages.reduce((m, p) => (p.timestamp > m ? p.timestamp : m), "");
  const coverage = Object.fromEntries(
    Object.entries(ctx.stats).map(([k, s]) => [k, { sentences: s.sentences, simulated: s.parsed, pct: s.sentences ? Math.round((1000 * s.parsed) / s.sentences) / 10 : 100 }]),
  );
  type O = Record<string, unknown>;
  const files = {
    identities: identities.map((x) => compactIdentity(x as unknown as O)),
    egos: egos.map((x) => compactEgo(x as unknown as O)),
    enemies: enemies.map((x) => compactEnemy(x as unknown as O)),
    gifts: gifts.map((x) => compactGiftDeep(x as unknown as O)),
    statuses: statuses.map((x) => compactStatus(x as unknown as O)),
  };
  mkdirSync(OUT, { recursive: true });
  const sizes: Record<string, number> = {};
  for (const [name, data] of Object.entries(files)) {
    // one item per line keeps git diffs of weekly refreshes small
    const json = "[\n" + (data as unknown[]).map((x) => JSON.stringify(x)).join(",\n") + "\n]\n";
    writeFileSync(join(OUT, `${name}.json`), json);
    sizes[name] = json.length;
  }
  const index = {
    format: 1,
    generatedAt: new Date().toISOString(),
    wikiUpdatedAt: latest,
    source: WIKI,
    license: "CC BY-SA 4.0",
    attribution: "Game data from the Limbus Company Wiki (limbuscompany.wiki.gg), licensed CC BY-SA 4.0. Limbus Company belongs to Project Moon.",
    counts: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])),
    sizes,
    coverage,
  };
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  console.log(JSON.stringify(index.counts), "coverage", JSON.stringify(coverage));
  const reportArg = args.indexOf("--report");
  if (reportArg >= 0) {
    const lines: string[] = [];
    for (const [bucket, m] of Object.entries(ctx.misses)) {
      lines.push(`## ${bucket}`);
      for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400)) lines.push(`${n}\t${k}`);
    }
    writeFileSync(args[reportArg + 1], lines.join("\n"));
  }
  if (skipped.length) console.log(`Skipped ${skipped.length} pages without usable data, e.g.:`, skipped.slice(0, 12).join(" | "));
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
