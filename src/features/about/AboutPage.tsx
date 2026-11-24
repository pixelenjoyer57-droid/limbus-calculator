import { useEffect, type ReactNode } from "react";
import { Card } from "../../ui/layout";
import { useGameData } from "../../gamedata";

const WIKI = "https://limbuscompany.wiki.gg";
const CC = "https://creativecommons.org/licenses/by-sa/4.0/";
const DISCORD = "https://discord.gg/hZgMnDN5K";
const ISSUES = "https://github.com/pixelenjoyer57-droid/limbus-calculator/issues/new/choose";
const OFL ="https://openfontlicense.org/open-font-license-official-text/";

function Ext({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={to} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}

/** "About & credits": what the app is, fan-made disclaimer, data attribution, third-party licenses, privacy. */
export default function AboutPage() {
  const gameIndex = useGameData((s) => s.index);
  const ensureIndex = useGameData((s) => s.ensureIndex);
  useEffect(() => void ensureIndex(), [ensureIndex]);
  const wikiDate = gameIndex ? gameIndex.wikiUpdatedAt.slice(0, 10) : "…";

  return (
    <div className="stack help" style={{ maxWidth: 900 }}>
      <Card>
        <h2>What this is</h2>
        <p>
          Sinner's Workshop is a free, non-commercial, <strong>fan-made</strong> tool for building custom Limbus Company content and testing it against the game's combat rules. It is{" "}
          <strong>not affiliated with, endorsed by or connected to Project Moon</strong>. Limbus Company, its characters, names, text and artwork belong to Project Moon. No game art, logos, audio or
          fonts from the game are included in this app.
        </p>
        <p>
          It is <strong>free and non-commercial</strong>: no ads, no donations and no paid features.
        </p>
        <p>
          The code is under the MIT license and the adapted game data under CC BY-SA 4.0 (see below and <span className="mono">LICENSE</span>, <span className="mono">LICENSE-DATA.md</span> in the repository).
          If you are a rights holder and want something changed or removed, see "Suggestions and contact" below and it will be handled promptly.
        </p>
      </Card>

      <Card>
        <h2 id="about-data">Game data and attribution</h2>
        <ul>
          <li>
            <strong>Source:</strong> the <Ext to={WIKI}>Limbus Company Wiki</Ext> (limbuscompany.wiki.gg), content as of {wikiDate}. Each built-in item records the wiki page or data module it came from, and the wiki's page history
            lists its authors. Formulas come from pages such as <Ext to={WIKI + "/wiki/Damage_Formula"}>Damage Formula</Ext> and <Ext to={WIKI + "/wiki/Battles"}>Battles</Ext>.
          </li>
          <li>
            <strong>License:</strong> the wiki's original text is released under <Ext to={CC}>Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)</Ext>. See the wiki's{" "}
            <Ext to={WIKI + "/wiki/Limbus_Company_Wiki:Copyrights"}>copyright page</Ext>.
          </li>
          <li>
            <strong>Changes made:</strong> the wiki pages were read by a script and converted into compact JSON; numbers were normalised (Uptie 4 for Identities, Threadspin IV for E.G.O); effect sentences
            were partly turned into simulation rules, and the rest kept as "Not simulated" notes; some entries were merged, shortened or left out. Errors in the conversion are ours, not the wiki's or Project Moon's.
          </li>
          <li>
            <strong>Share-alike:</strong> the adapted data files (<span className="mono">public/gamedata</span>) are offered under the same CC BY-SA 4.0 license. If you reuse them, give the same credit and say what you changed.
          </li>
          <li>
            <strong>Project Moon's material:</strong> names, skill and passive text and other official game content belong to Project Moon. The wiki transcribes it under its own fair-use position, and it is{" "}
            <em>not</em> covered by the wiki's CC license. It is shown here only so you can test fan content against the real rules, for non-commercial use.
          </li>
          <li>
            <strong>Copies in your files:</strong> backups and share codes may contain copies of this data (when you copy a built-in item into your workshop). The same credit and license apply to those copies.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 id="about-third">Third-party software</h2>
        <ul>
          <li>
            <strong>Atkinson Hyperlegible</strong> font (via the <span className="mono">@fontsource</span> package), copyright 2020 Braille Institute of America, Inc., under the{" "}
            <Ext to={OFL}>SIL Open Font License 1.1</Ext>.
          </li>
          <li>
            <strong>React</strong> and <strong>React DOM</strong> (Facebook/Meta, MIT), <strong>immer</strong> (MIT), <strong>zustand</strong> (MIT), <strong>zod</strong> (MIT), <strong>lz-string</strong> (MIT).
            Full notices are in the project's <span className="mono">NOTICE.md</span>.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 id="about-privacy">Privacy</h2>
        <p>
          Everything you create stays in <strong>your browser</strong> on your device (local storage and the offline cache). The app has no account, no analytics, no ads and no tracking, and it does not send
          your workshops anywhere. The page is served by GitHub Pages, which, like any web host, may log your IP address in its own server logs. Share codes and backup files exist only when you make them; whoever you
          give them to can read their contents. Clear your browser's site data to delete everything.
        </p>
      </Card>

      <Card>
        <h2 id="about-contact">Suggestions and contact</h2>
        <p>
          Ideas, bug reports and corrections are welcome in the <Ext to={DISCORD}>Discord</Ext> or as <Ext to={ISSUES}>GitHub issues</Ext>. By sending a suggestion you allow it to be used to improve this app without
          payment. Please do not post other people's private information, and do not post leaked or unreleased game material. The Discord is for people aged 13 or older.
        </p>
        <p>
          We name you in public, for example in the changelog, only if you say yes. Otherwise it says "community suggestion". We keep only your display name, the channel and the date. Giving a name is optional.
        </p>
        <p>
          We may copy suggestions, bug reports and custom kits you post on Discord or GitHub into our private notes. We may read them with third-party AI tools to help plan the work. We keep your name while we consider
          the idea. We delete it from our notes on request. Your original post stays under Discord's or GitHub's own rules.
        </p>
        <p>
          To ask us to name you, or to delete your name, message a Discord moderator or comment on
          your <Ext to={ISSUES}>GitHub issue</Ext>. Please leave personal details out of public comments. The app does not send your workshops or data anywhere. See Privacy above for the host's logs.
        </p>
        <p>
          <strong>Rights holders:</strong> to request a takedown, correction or change of credit, use the <Ext to={ISSUES}>"Rights holder request" form</Ext> or message a Discord moderator.
        </p>
      </Card>

      <Card>
        <h2>Accessibility</h2>
        <p>
          The app aims for keyboard use, screen-reader labels, scalable text, high-contrast and reduced-motion options (see Save, share &amp; settings). If something blocks you, please report it.
        </p>
      </Card>
    </div>
  );
}
