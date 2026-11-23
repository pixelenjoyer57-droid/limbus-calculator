# Legal / licensing review - Sinner's Workshop

Date: 2026-11-23. Prepared by an AI assistant, **not a lawyer; this is a risk assessment, not legal advice.** Anything involving money (donations, ads, paid tiers) needs a professional.

## Verdict

Making and sharing this app as a **free, non-commercial fan project is low-to-moderate risk** and consistent with the only public Project Moon statement found. The real exposure is not the code but (1) the **official game text** shipped in `public/gamedata` (skill/passive/Gift descriptions), which is Project Moon's copyright and is **not** covered by the wiki's CC BY-SA license, and (2) the **missing visible attribution and license notices** (fixed in this change). Opening a Discord is fine if it stays non-commercial and has simple posted rules. Do not monetise without taking advice and asking Project Moon.

## Risks, ranked (likelihood x impact)

1. **Project Moon text in the data set (medium likelihood of a takedown request if the project becomes prominent, medium impact).** The wiki says official content is Project Moon's copyright, used there under fair use. Our app redistributes much of it in bulk, in a downloadable JSON, which is a weaker position than a wiki's transformative use. Mitigation: non-commercial, disclaimer, takedown readiness (done in the About page / README); optional: ship numbers and structure but paraphrase or drop long description strings (`text` fields), or fetch on demand. Decision D2.
2. **Dependence on a vague permission (low-medium likelihood, high impact if it changes).** Project Moon's statement (2021 Q&A): "Generally, we freely allow fanworks as long as it's not done for commercial purposes", with a promised later guideline; no later guideline was found. It is a general Q&A answer about fan works, not a license for data redistribution. Mitigation: stay non-commercial, comply promptly with any request.
3. **CC BY-SA 4.0 compliance gaps (high likelihood before this change, low impact).** Before: only a one-line credit in Help/README/index.json, no license link, no "changes made", no per-source link. Now: About & credits page, README, NOTICE.md, richer `index.json`. Remaining gap: copies inside users' backups/share codes do not themselves carry a notice (see D4). Whoever is credited is "Limbus Company Wiki contributors" collectively; the license allows a reasonable attribution via a link to the pages/history.
4. **ShareAlike scope (low likelihood, low-medium impact).** The adapted data must be CC BY-SA 4.0. Code that merely loads the data is generally a separate work, but this is not settled; keep the data in its own folder with its own license file to keep the line clear. Choosing a code license that is incompatible-looking (all rights reserved forced on whole repo) would conflict; hence D1.
5. **No repository license (certain, low-medium impact).** Default is all rights reserved: others cannot legally fork, and community contributors have no stated terms. Proposals drafted in `docs/license-proposals/`; the owner decides (D1).
6. **Trademarks/names (low).** Using "Limbus Company" descriptively with a clear "not affiliated" disclaimer is normal fan practice. The app name "Sinner's Workshop" does not use a Project Moon mark by itself, but "Sinner" is in-universe terminology; low risk. Avoid logos, official art, and anything implying endorsement. No game art is shipped (verified: tokens are letter monograms).
7. **Wiki scraping (low).** The importer (`scripts/gamedata/wiki.ts`) uses the MediaWiki API, identifies itself with a descriptive User-Agent, sequential requests, 350 ms pause, `maxlag=5`, 50 titles per call and a local cache. That is polite. wiki.gg's network-wide terms could not be fetched from this environment, so I could not confirm whether they restrict automated access; keep the cadence low (it only runs on demand / by the maintainer). Also unverified: wiki.gg's robots/ToS.
8. **Third-party licenses (low).** All MIT plus the OFL font; MIT requires the copyright and license text to accompany copies in the distributed bundle. Vite normally strips license comments from the bundle; `NOTICE.md` and the About page cover this at repository/app level. The font files are shipped unmodified; OFL allows bundling; it forbids selling the font alone and reserved font names for modified versions (not applicable).
9. **Privacy (low).** The app stores data only in the browser and has no analytics (grep found no tracking or network calls other than loading its own static data). Hosting on GitHub Pages means GitHub may log visitors' IPs; that is covered in the privacy note. If you ever add analytics, error reporting, a hosted share service or accounts, the privacy note, a cookie/consent approach and (for EU users) GDPR duties change. A Discord server adds that Discord handles members' data; do not harvest it.
10. **Discord / community (low).** Discord requires members to be 13+; set a rules channel, a moderation team, and post the contribution terms (`docs/license-proposals/CONTRIBUTING-TERMS.md.proposal`). Do not allow leaks, ripped assets or datamined unreleased content in the server. Donations or paid roles would make it commercial (see D3).

## What was changed

- New in-app page **About & credits** (`src/features/about/AboutPage.tsx`, route `#/about`, sidebar link in `src/app/App.tsx`): fan-made disclaimer, data attribution with wiki and CC BY-SA 4.0 links, "changes made", ShareAlike note, Project Moon carve-out, third-party licenses, privacy, suggestions/takedown contact (no Discord link yet), accessibility.
- `scripts/gamedata/build.ts`: `index.json` now has `licenseUrl` and a full attribution/changes-made string; data regenerated offline (counts unchanged: 197 / 114 / 1158 / 728 / 1266).
- `README.md`: expanded license/attribution bullet and a Legal notes section.
- `NOTICE.md`: data attribution and third-party license table.
- `docs/license-proposals/`: MIT code proposal, CC BY-SA data proposal, contribution terms, options table. None is in force; no root LICENSE was added.

## Decisions for the owner

- **D1 Code license.** Options in `docs/license-proposals/README.md`. Recommendation: MIT for code + CC BY-SA 4.0 for `public/gamedata` (data license file inside that folder). Needed before accepting outside code contributions.
- **D2 Official description text.** Keep as is (simplest, fits non-commercial fair-use norms but is the largest risk) or reduce it. Recommendation: keep for now, ship the About disclaimer, and be ready to strip description strings quickly on request; consider contacting Project Moon (via their official channels; I could not verify a specific fan-content contact) for explicit permission before the project grows large.
- **D3 Money.** Do not add donations/ads/paid features without advice. Recommendation: stay free; if you want donations, ask Project Moon first.
- **D4 Notice inside exports.** Backups/share codes could carry a short credit field (needs changes in `src/data/migrate.ts` and `src/features/data/*`, owned by the other specialist). Recommendation: add a one-line `credits` string to exports; low effort.
- **D5 Contact channel for takedowns.** About page says "see Suggestions and contact"; decide on an email or GitHub issues link and add it. Recommendation: a dedicated email or a GitHub issue template, plus the Discord for suggestions.
- **D6 Discord rules.** Post the terms in `docs/license-proposals/CONTRIBUTING-TERMS.md.proposal`; link them from the About page "Suggestions and contact" section (replace its text with the Discord link https://discord.gg/hZgMnDN5K when ready). Recommendation: yes, with at least two moderators and a #rules channel.

## Needed from the other specialist's files (not edited by me)

- Build step (`vite.config` / package.json) could copy `NOTICE.md` into `dist/` so the deployed site serves it, and the service worker should precache `#/about` assets (the page is a lazy chunk, handled automatically if the SW caches built assets).
- `index.html` could add a `<meta name="description">` stating "fan-made, not affiliated".
- Export/share-code credit field (D4).

## Sources

- Library of Ruina wiki, 2021 ProjectMoon Q&A: https://libraryofruina.wiki.gg/wiki/2021_ProjectMoon_Q&A (quote taken from the project's briefing; the page itself was not re-fetched by me).
- Limbus Company Wiki copyright policy, fetched via the MediaWiki API: https://limbuscompany.wiki.gg/wiki/Limbus_Company_Wiki:Copyrights (CC BY-SA 4.0 for original text; official assets are Project Moon's, used under fair use).
- CC BY-SA 4.0 deed and legal code: https://creativecommons.org/licenses/by-sa/4.0/ (not fetched; summarised from the wiki's copy and general knowledge).
- Atkinson Hyperlegible: license text read from `node_modules/@fontsource/atkinson-hyperlegible/LICENSE` (SIL OFL 1.1, Braille Institute of America).
- npm package LICENSE files in `node_modules` (copyright lines verified).
- Could not verify (network blocked or not attempted): wiki.gg network terms of service, Project Moon's current official fan-content guidelines, Discord's current ToS text.
