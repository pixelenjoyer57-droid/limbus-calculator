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

Fan-made tool, not affiliated with Project Moon. Limbus Company and its terms belong to their owners.
