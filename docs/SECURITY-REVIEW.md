# Security review

Scope: whole repository (static React/Vite app, service worker, import/share code paths, GitHub Actions workflow, dependencies, game-data importer). Prepared before the public Discord opens. Method: code read-through plus a built-app run in Chromium (desktop and iPhone 13 profiles) under the new Content Security Policy.

## Findings

| # | Severity | Where | Issue | Status |
|---|----------|-------|-------|--------|
| 1 | High | `src/data/migrate.ts` (`decodeShareCode`, now `boundedDecompress`) | lz-string output can grow quadratically: a share code of a few hundred KB can decompress to gigabytes and freeze or crash the tab (zip bomb). Any stranger's share code reaches this. | Fixed: own decoder with a 16M-character output cap, 4M-character input cap. Tests in `tests/security.test.ts`. |
| 2 | Medium | `index.html` | No Content Security Policy, so any future XSS sink would run unrestricted. | Fixed: meta CSP (`default-src 'none'`, scripts/workers/connect/fonts/images from this origin only, no inline script, no eval). |
| 3 | Medium | `src/data/migrate.ts:164` (and the items/legacy paths) | `data.kind in SCHEMA_BY_KIND` is true for `constructor`, `toString`, `__proto__`: a crafted file threw an uncaught `TypeError` in the import handler. Legacy import also looked up `OLD_SIN[...]` the same way and stored non-string values unvalidated. | Fixed: own-property checks, `importAny` never throws, legacy items now pass through the zod schemas. |
| 4 | Medium | `src/data/migrate.ts` `importAny`, `src/lib/files.ts` `pickFile` | No size limits on files, pasted text or item counts; a huge backup freezes the tab (and the zod advisory below makes large arrays costlier). | Fixed: 12 MB file/text cap, 3000 items per collection. |
| 5 | Medium | `src/data/migrate.ts` `importAny` | Imported items could carry ids in the game's reserved `g:` namespace, which the app treats as game data (shadowing or confusing lookups). | Fixed: such ids are replaced with fresh ones on import. |
| 6 | Medium | `public/sw.js` | Navigations were cached even for 404/500 responses (an error page could be served offline later); un-hashed files (icons, manifest) were cache-first forever; no check that responses are same-origin `basic`. | Fixed: only `ok` + `basic` responses are cached; cache-first only for `assets/` (hashed names); everything else network-first; cache bumped to v3 so old caches are dropped. |
| 7 | Medium | `.github/workflows/pages.yml` | Actions referenced by movable tags; `pages: write` and `id-token: write` granted to the build job; checkout kept credentials. | Fixed: actions pinned to commit SHAs, permissions per job (build: read only), `persist-credentials: false`, `npm ci --ignore-scripts`, `npm audit --omit=dev --audit-level=critical` gate. |
| 8 | Low | `DataPage.tsx`, `Home.tsx`, `HelpPage.tsx` | External links used `rel="noreferrer"` only. Modern browsers imply noopener, but older ones do not. | Fixed: `rel="noopener noreferrer"`. (The link in `src/features/about/AboutPage.tsx:11` still uses `noreferrer` alone; owned by the other specialist, harmless in current browsers.) |
| 9 | Medium | `package.json` (zod 3.25.76) | `npm audit`: zod high, "memory exhaustion validating oversized constrained collections". Fix is zod 4.x (breaking API change). | Fixed: zod 4.6.7. Input is also size-capped (findings 1 and 4). Parsing was compared old vs new on about 14,000 real and mutated inputs (all game data, hostile variants): identical output. |
| 10 | Low | `package.json` (vite 5, vitest 2) | `npm audit`: vite/esbuild/vitest/tinypool advisories (dev server file read / RCE when the dev server or vitest UI is exposed). Dev-only, not in the shipped site. | Fixed: vite 8.3.8, vitest 5.1.1, @vitejs/plugin-react 6.3.0. `npm audit` reports 0 vulnerabilities. Still do not expose `npm run dev` to a network. |
| 11 | Info | GitHub Pages | Project pages share one origin (`<user>.github.io`) with every other repository of the same account, and so share `localStorage` and cache scope. Another page of yours could read workshops. | Open (owner): use a custom domain, or keep other sites on that account trusted. |
| 12 | Info | `index.html` | `frame-ancestors` and `X-Frame-Options` cannot be set from a meta tag, so the page can be framed (clickjacking). There are no sensitive actions or accounts, so impact is low. | Open (platform limit). |
| 13 | Info | `.github/workflows/pages.yml` | Deploys also ran from the branch `ccr-c94fdac2-l0ku94`. | Fixed (2026-11-23): the branch was renamed to `main` and the workflow now deploys from `main` only. The `github-pages` environment must allow `main`. |
| 14 | Info | `mergeItems` | Importing into the current workshop replaces items with the same id (by design, for round trips). Ids are random, so a stranger cannot target yours unless they have your export. The import dialog says so and Undo is offered. | Accepted. |
| 15 | Info | engine | Hostile rule sets: reuse capped (`MAX_REUSE`), trigger depth capped (6), batch runs capped (5000). The worker cannot be cancelled mid-run (user-started only). | Accepted. |
| 16 | Info | privacy | Browser test shows no request leaves the site origin; no analytics, no cookies, no telemetry. The wiki importer (`scripts/gamedata`) runs only on a developer machine. | Confirmed. |
| 17 | Medium | `src/data/schema.ts` (found while upgrading) | zod 4 probes `new Function` to JIT-compile parsers. Under the meta CSP (no `unsafe-eval`) the probe is caught but still reported as a `securitypolicyviolation`. | Fixed: `z.config({ jitless: true })` at the top of `schema.ts`; test in `tests/credits.test.ts`; browser run shows zero violations. |
| 18 | Info | exports | Exports containing items copied from the game data now carry a top-level `credits` string (wiki CC BY-SA 4.0 / Project Moon notice), only when such items (non-empty `source`) are included. Import ignores it; old files still import. | Done (`withCredits` in `src/data/migrate.ts`; backup file, workshop share code and item exports). |

Checked and fine: no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `src`; the only `href` values built from data are the wiki link (fixed origin, path segments URL-encoded) and in-app `#/` routes; no auto-import from the URL hash (share codes must be pasted); `__proto__`/`constructor` keys in payloads do not pollute (tested); item names containing markup stay plain text (React escapes).

## What changed

- `index.html`: CSP meta tag and `no-referrer`.
- `src/data/migrate.ts`: bounded share-code decoder, size caps, own-property checks, `g:` id protection, safe `importAny`, legacy items validated; `withCredits` / `CREDITS`.
- `src/lib/files.ts`: 12 MB file cap before reading.
- `public/sw.js`: safer caching rules, cache v3.
- `.github/workflows/pages.yml`: pinned actions, least privilege, audit gate.
- `.github/dependabot.yml`: weekly npm (minor/patch grouped, majors separate) and github-actions updates, on the default branch.
- Dependencies (exact pins): zod 3.25.76 to 4.6.7, vite 5.4.21 to 8.3.8, vitest 2.1.9 to 5.1.1, @vitejs/plugin-react 4.7.0 to 6.3.0. `package.json`: `"license": "MIT"`, `engines.node` `^20.19.0 || >=22.12.0` (vite 8 needs it; CI uses Node 22).
- zod 4 code changes: `z.record(zSinner, ...)` became `z.partialRecord(...)` (zod 4 makes enum-keyed records exhaustive); `z.config({ jitless: true })`; `vite.config.ts` imports `defineConfig` from `vitest/config`. Nothing else was needed: `.catch().default()` chains behave the same because every default is itself valid.
- Link `rel` attributes in three pages.
- New: `tests/security.test.ts`, `tests/credits.test.ts`, `SECURITY.md`, this file.

CSP in the browser (built app, vite preview, desktop and iPhone 13): Home, Builder (including "From the game": list, open an enemy, copy it), Teams, Calculator (result), Simulator (start, one turn, "Run N fights" in the Web Worker), Save/share (backup file and share code created, then both re-imported), Help and About loaded with zero CSP violations and zero console errors; the service worker registered; no cross-origin requests.

## Owner checklist (GitHub settings, by hand)

Update 2026-11-23: the owner renamed the default branch to `main` and enabled the settings below. `pages.yml` deploys from `main` only; the `github-pages` environment's deployment branches must list `main` (not the old `ccr-c94fdac2-l0ku94`).

- Settings > Code security: enable **Private vulnerability reporting** (SECURITY.md points reporters there), **Dependabot alerts**, **Dependabot security updates**, and **Secret scanning** with **Push protection**. (Dependabot version updates are configured in `.github/dependabot.yml`; merge it to the default branch for it to take effect.)
- Settings > Branches (or Rules > Rulesets): protect `main`: block force pushes and deletion (done). Requiring pull requests / passing checks is optional; it would require changes to arrive as pull requests instead of direct pushes.
- Settings > Environments > `github-pages`: limit deployment branches to the default branch; remove any temporary branch from the workflow when done (finding 13).
- Settings > Actions > General: default workflow permissions "Read repository contents"; allow only GitHub-owned actions (or the pinned ones).
- Settings > Pages: Source "GitHub Actions"; turn on **Enforce HTTPS**; consider a custom domain (finding 11).
- Review Dependabot major-version pull requests by hand (they are not grouped).
- Moderation: tell Discord members that share codes and backups are data but to import only into a throwaway workshop first.
