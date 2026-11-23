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
| 9 | Medium | `package.json` (zod 3.25.76) | `npm audit`: zod high, "memory exhaustion validating oversized constrained collections". Fix is zod 4.x (breaking API change). | Open: mitigated by findings 1 and 4 (input is size-capped before validation). Upgrade needs an owner decision and a migration. |
| 10 | Low | `package.json` (vite 5, vitest 2) | `npm audit`: vite/esbuild/vitest/tinypool advisories (dev server file read / RCE when the dev server or vitest UI is exposed). Dev-only, not in the shipped site. | Open: fix needs vite 8 / vitest 5 (major). Do not expose `npm run dev` to a network; update when convenient. |
| 11 | Info | GitHub Pages | Project pages share one origin (`<user>.github.io`) with every other repository of the same account, and so share `localStorage` and cache scope. Another page of yours could read workshops. | Open: use a custom domain, or keep other sites on that account trusted. |
| 12 | Info | `index.html` | `frame-ancestors` and `X-Frame-Options` cannot be set from a meta tag, so the page can be framed (clickjacking). There are no sensitive actions or accounts, so impact is low. | Open (platform limit). |
| 13 | Info | `.github/workflows/pages.yml` | Deploys also run from the branch `ccr-c94fdac2-l0ku94`. | Open: remove it from `on.push.branches` when finished, and restrict branches on the `github-pages` environment. |
| 14 | Info | `mergeItems` | Importing into the current workshop replaces items with the same id (by design, for round trips). Ids are random, so a stranger cannot target yours unless they have your export. The import dialog says so and Undo is offered. | Accepted. |
| 15 | Info | engine | Hostile rule sets: reuse capped (`MAX_REUSE`), trigger depth capped (6), batch runs capped (5000). The worker cannot be cancelled mid-run (user-started only). | Accepted. |
| 16 | Info | privacy | Browser test shows no request leaves the site origin; no analytics, no cookies, no telemetry. The wiki importer (`scripts/gamedata`) runs only on a developer machine. | Confirmed. |

Checked and fine: no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `src`; the only `href` values built from data are the wiki link (fixed origin, path segments URL-encoded) and in-app `#/` routes; no auto-import from the URL hash (share codes must be pasted); `__proto__`/`constructor` keys in payloads do not pollute (tested); item names containing markup stay plain text (React escapes).

## What changed

- `index.html`: CSP meta tag and `no-referrer`.
- `src/data/migrate.ts`: bounded share-code decoder, size caps, own-property checks, `g:` id protection, safe `importAny`, legacy items validated.
- `src/lib/files.ts`: 12 MB file cap before reading.
- `public/sw.js`: safer caching rules, cache v3.
- `.github/workflows/pages.yml`: pinned actions, least privilege, audit gate.
- Link `rel` attributes in three pages.
- New: `tests/security.test.ts`, `SECURITY.md`, this file.

CSP in the browser: Home, Builder (including "From the game"), Teams, Calculator, Simulator (batch in the Web Worker), Save/share (share code create and import) and Help/About loaded on desktop and phone with no CSP violations or console errors; the service worker registered; no cross-origin requests.

## Owner checklist (GitHub settings, by hand)

- Settings > Code security: enable **Private vulnerability reporting** (SECURITY.md points reporters there), **Dependabot alerts** and **Dependabot security updates**, and **Secret scanning** with **Push protection**.
- Add a Dependabot version-updates config (`.github/dependabot.yml`, npm and github-actions, weekly) so pinned action SHAs get update pull requests.
- Settings > Branches: protect `main` (require a pull request, require the workflow to pass, block force pushes and deletion).
- Settings > Environments > `github-pages`: limit deployment branches to `main`; remove the temporary branch from the workflow when done.
- Settings > Actions > General: workflow permissions "Read repository contents", and allow only GitHub-owned actions (or the pinned ones).
- Settings > Pages: Source "GitHub Actions"; consider a custom domain (finding 11) and "Enforce HTTPS".
- Decide on the zod 4 and vite/vitest major upgrades (findings 9 and 10).
- Moderation: tell Discord members that share codes and backups are data but to import only into a throwaway workshop first.
