# Notice and third-party licenses

Sinner's Workshop is a free, non-commercial, fan-made tool. It is **not affiliated with, endorsed by or connected to Project Moon**. Limbus Company and all related names, characters, text and artwork belong to Project Moon. No game art, logos, audio or fonts are included.

The app's own code is licensed under the MIT license (`LICENSE`); the adapted game data under CC BY-SA 4.0 (`LICENSE-DATA.md`). The project is free and non-commercial: no ads, donations or paid features. (This file is informational; it is not legal advice.)

## Game data (`public/gamedata/`)

- Adapted from the Limbus Company Wiki, https://limbuscompany.wiki.gg . Its original text is licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/ (legal code: https://creativecommons.org/licenses/by-sa/4.0/legalcode). Wiki policy: https://limbuscompany.wiki.gg/wiki/Limbus_Company_Wiki:Copyrights . Authors are listed in each wiki page's history; each data item's `source` field names its page or data module.
- **Changes made:** pages were read through the wiki API and converted into compact JSON; values normalised (Identities at Uptie 4, E.G.O at Threadspin IV); effect sentences partly converted into simulation rules, the rest kept as notes; some entries merged, shortened or omitted.
- **ShareAlike:** the adapted data files are offered under CC BY-SA 4.0. No additional restrictions are placed on them.
- **Not covered by the wiki license:** official game names, skill/passive/Gift text and other Project Moon material. The wiki states these are Project Moon's copyright, used there under fair use. They are included here only for non-commercial fan use and will be removed or changed on request of the rights holder.

## Third-party software shipped in the built app

| Package | Version | License | Copyright |
|---|---|---|---|
| @fontsource/atkinson-hyperlegible (Atkinson Hyperlegible font, files 400/700 latin and others) | 5.2.8 | SIL Open Font License 1.1 | Copyright 2020 Braille Institute of America, Inc. |
| react, react-dom | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates |
| immer | 10.1.1 | MIT | Copyright (c) 2017 Michel Weststrate |
| zustand | 4.5.7 | MIT | Copyright (c) 2019 Paul Henschel |
| zod | 3.25.76 | MIT | Copyright (c) 2025 Colin McDonnell |
| lz-string | 1.5.0 | MIT | Copyright (c) 2013 pieroxy |

The MIT license text: permission is granted, free of charge, to use, copy, modify, merge, publish, distribute, sublicense and sell copies of the software, provided the above copyright notice and this permission notice are included in all copies; the software is provided "as is", without warranty of any kind.

The OFL 1.1 full text and FAQ: https://openfontlicense.org/open-font-license-official-text/ and in `node_modules/@fontsource/atkinson-hyperlegible/LICENSE`. The font is bundled unmodified and not sold on its own. Build tools (Vite, TypeScript, Vitest, etc.) are not shipped in the app.


Copyright lines were checked against each package's LICENSE file in node_modules (version pins in package.json). Re-check when upgrading.
