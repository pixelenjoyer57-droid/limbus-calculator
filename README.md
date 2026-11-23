# Sinner's Workshop — Limbus custom kit lab

A browser app for building **custom Limbus Company content** and testing it against the game's real combat rules:

- **Builder** for Identities, E.G.O, enemies (including multi-part Abnormalities), encounters (waves), choice events with Skill Checks, E.G.O Gifts (with + / ++ versions), your own custom status effects and **custom coins**.
- **Custom coins**: any coin can have its own Coin Power, damage type, sin, Heads chance or fixed result, or multiply the power on Heads; reusable **coin types** add Clash behaviour (normal / unbreakable / excision), cracked power, Paralyze immunity and rules carried by every coin of that type.
- **Rule builder** for effects: "When [On Hit] → only if [target has 5+ Burn] → do [Inflict 2 Burn]". Every rule shows game-style text live, and the simulator actually runs it.
- **Damage calculator**: one Clash or one-sided attack, run thousands of times through the real engine, with best/worst-case breakdowns that show every term of the damage formula for each coin.
- **Battle simulator**: play a fight turn by turn (pick skills and targets, see Clash odds and every coin flip), auto-play it, or run hundreds of fights for win rates and per-unit averages.
- **Teams**: 12 Sinners, Identity + level + Uptie + one E.G.O per grade, deployment order, gifts, starting E.G.O resources.
- **Event tester**: success chance of every Sinner for each Skill Check.

It runs entirely in the browser (phone or PC) and works offline after the first visit.

## Saving, sessions and moving between devices

- Everything saves automatically in the browser ("Saved" at the top). There is **no "unsaved changes" prompt** and **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z) covers deletes too.
- **Workshops** are separate save slots — switch between projects without losing anything.
- The app remembers where you were: last screen, open sections, calculator inputs and a fight in progress (even after closing the tab).
- To move work between phone and PC: **Save, share & settings → Download backup file** or **Get share code**, then import it on the other device. Single items have Export / Share buttons too.
- The original one-page *Sinner's Workshop* export file can be imported directly.

## Accuracy

Formulas come from the community wiki ([Damage Formula](https://limbuscompany.wiki.gg/wiki/Damage_Formula), [Battles](https://limbuscompany.wiki.gg/wiki/Battles), [Skills](https://limbuscompany.wiki.gg/wiki/Skills), [Sanity](https://limbuscompany.wiki.gg/wiki/Sanity), [Sin Resonance](https://limbuscompany.wiki.gg/wiki/Sin_Resonance), status pages). In short:

```
Damage = floor( Coin Roll × (1 + Static) × (1 + Dynamic) )   (min 1, min 5% of the roll)
Static  = sin res + damage-type res (or +1/+1.5/+2 when Staggered) + (Off−Def)/(|Off−Def|+25) + crit 0.2 + 0.03 × Clash count
Dynamic = Damage Up/Down, Fragile, Protection, typed variants, passive / skill / gift "+X% damage"
Resistance mod = x−1 (x ≥ 1) · (x−1)/2 (x < 1) · −0.5 (Immune)
Heads chance = 50 + SP · Clash bonus = +1 per 3 levels · SP on Clash win = 10 + 2 × (rounds − 1)
```

`tests/` checks these against the wiki's own worked examples (e.g. +37% for Slash ×1.5 & Wrath ×0.75, +250% at Stagger++ with ×1.5, ×1.44 for crit + 2 Fragile) and hand-calculated fights. The in-app **How combat works** page lists everything, including what the simulator simplifies (enemy AI, Low Morale chance, E.G.O Corrosion at −45 SP, slot weight / Aggro).

## Game data

The app ships with in-game content imported from the [Limbus Company Wiki](https://limbuscompany.wiki.gg): about 197 Identities (Uptie 4), 114 E.G.O (Threadspin IV), 1158 enemy variants (human enemies and multi-part Abnormalities), 728 E.G.O Gifts and 1266 statuses. Pick them in the calculator, teams, encounters and simulator, or copy one into your workshop to edit it. Effects are converted from the wiki text automatically (roughly half of all effect sentences become simulated rules; the rest is shown as "Not simulated" notes).

- **License / attribution:** the data is adapted from the [Limbus Company Wiki](https://limbuscompany.wiki.gg) (limbuscompany.wiki.gg), whose original text is licensed [**CC BY-SA 4.0**](https://creativecommons.org/licenses/by-sa/4.0/). **Changes were made**: pages were converted to compact JSON, values normalised (Uptie 4 / Threadspin IV), effect text partly converted into simulation rules, some entries merged or omitted. The adapted data stays under CC BY-SA 4.0. Official game names and text belong to Project Moon and are not covered by the wiki's license. No game art, logos, audio or fonts are included. Full credits: the in-app **About & credits** page and [NOTICE.md](NOTICE.md).
- **Refresh it locally:** `npm run gamedata` fetches from the wiki and keeps a local cache in `.cache/wiki`; `npm run gamedata -- --offline` reuses the cache; `npm run gamedata -- --report <file>` writes the top unconverted sentences.
- The files in `public/gamedata/` are **generated** (one item per line, so diffs stay readable). Don't edit them by hand; they are loaded on demand in the browser.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # engine + formula tests (vitest)
npm run build      # type-check and build to dist/
```

Stack: React 18 + TypeScript + Vite, zustand + immer for state, zod for validating saved/imported data, a Web Worker for simulations. Navigation uses the URL hash, so the build works from any sub-folder.

```
src/engine/    combat engine (formulas, statuses, effects, clashes, turns, calculator, batch runs) — no UI code
src/data/      content schema, defaults/templates, import & migration
src/store/     workspace (autosave, undo), session ("where was I"), settings, toasts
src/features/  screens: home, library (builder), team, calc, sim, data, help
src/ui/        accessible components (number steppers, sections, dialogs, tips)
tests/         vitest suites
```

## Publishing on GitHub Pages

The workflow in `.github/workflows/pages.yml` tests, builds and deploys on every push to `main` (or the development branch).
One-time setup in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site then appears at
`https://<your-user>.github.io/limbus-calculator/`.

## Accessibility

Dark / light / high-contrast themes, text size up to 160%, an extra-readable font (Atkinson Hyperlegible), reduced motion, compact or roomy spacing, optional inline hints, large touch targets, full keyboard use and screen-reader labels. Screens use one main action, collapsible sections that remember their state, templates instead of blank pages, and summaries of "things to check" instead of blocking errors.

---

## Legal notes

Fan-made, free and non-commercial; **not affiliated with, endorsed by or connected to Project Moon**. Limbus Company and its names, text and characters belong to Project Moon. **Free and non-commercial: no ads, donations or paid features.** Rights holders: if you want something changed or removed, use the ["Rights holder request" form](https://github.com/pixelenjoyer57-droid/limbus-calculator/issues/new/choose) or message a moderator on the [Discord](https://discord.gg/hZgMnDN5K) and it will be handled promptly. See [NOTICE.md](NOTICE.md) for data attribution and third-party licenses and [docs/LEGAL-REVIEW.md](docs/LEGAL-REVIEW.md) for the (non-lawyer) review. Privacy: the app keeps everything in your browser, with no analytics or accounts.

## License

- **Code:** [MIT](LICENSE).
- **Game data** (`public/gamedata/`): [CC BY-SA 4.0](LICENSE-DATA.md), adapted from the Limbus Company Wiki. This does **not** cover Project Moon's own material (names, skill/passive/Gift text and so on), which remains Project Moon's.
- Third-party software and full attribution: [NOTICE.md](NOTICE.md).

## Community

Suggestions, questions and custom kits are welcome in the [Discord](https://discord.gg/hZgMnDN5K) or as [GitHub issues](https://github.com/pixelenjoyer57-droid/limbus-calculator/issues/new/choose). See [CONTRIBUTING.md](CONTRIBUTING.md) for the simple contribution terms. Security problems: [SECURITY.md](SECURITY.md).
