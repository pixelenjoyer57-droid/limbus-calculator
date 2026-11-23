import { useEffect } from "react";
import { BUILTIN_STATUS_LIST, KEYWORD_STATUSES, TREMOR_TYPE_INFO, TREMOR_TYPES } from "../../engine/statuses";
import { ABSOLUTE_RESONANCE_BONUS, RESONANCE_BONUS, SIN_LABEL } from "../../engine/constants";
import { levelAdvantage } from "../../engine/formulas";
import { Card } from "../../ui/layout";
import { useGameData } from "../../gamedata";


const WIKI = "https://limbuscompany.wiki.gg/wiki/";
const SECTIONS = [
  ["damage", "Damage formula"],
  ["clash", "Clashes"],
  ["coins", "Coins & custom coins"],
  ["sanity", "Sanity (SP)"],
  ["stagger", "Stagger"],
  ["turn", "A turn, step by step"],
  ["defense", "Defense skills"],
  ["resonance", "Sin Resonance & passives"],
  ["ego", "E.G.O"],
  ["statuses", "Status effects"],
  ["gamedata", "Game data from the wiki"],
  ["limits", "What the simulator simplifies"],
] as const;

function Src({ page, label }: { page: string; label?: string }) {
  return (
    <a href={WIKI + page} target="_blank" rel="noreferrer" className="small">
      Source: {label ?? page.replace(/_/g, " ")} (wiki) ↗
    </a>
  );
}

export default function HelpPage({ section }: { section?: string }) {
  useEffect(() => {
    if (section) document.getElementById("help-" + section)?.scrollIntoView();
  }, [section]);
  const gameIndex = useGameData((s) => s.index);
  const ensureIndex = useGameData((s) => s.ensureIndex);
  useEffect(() => void ensureIndex(), [ensureIndex]);
  const c = gameIndex?.counts;
  const covRaw = gameIndex?.coverage;
  const cov = covRaw && { identity: Math.round(covRaw.identity.pct), ego: Math.round(covRaw.ego.pct), enemy: Math.round(covRaw.enemy.pct), gift: Math.round(covRaw.gift.pct) };
  const wikiDate = gameIndex ? gameIndex.wikiUpdatedAt.slice(0, 10) : "…";
  const keyword = BUILTIN_STATUS_LIST.filter((d) => (KEYWORD_STATUSES as readonly string[]).includes(d.key));
  const general = BUILTIN_STATUS_LIST.filter((d) => !(KEYWORD_STATUSES as readonly string[]).includes(d.key) && !d.dmgType && !d.sinFilter);
  return (
    <div className="stack help" style={{ maxWidth: 900 }}>
      <Card>
        <p>
          This page lists every rule the calculator and simulator use, in plain words, with the formulas from the Limbus Company wiki. You don't need to read it to use the app —
          come back when a number surprises you.
        </p>
        <nav aria-label="On this page">
          <ul className="row" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a className="tab" href={`#/help/${id}`}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Card>

      <Card>
        <h2 id="help-damage">Damage formula</h2>
        <p>Every coin that hits deals damage on its own:</p>
        <div className="formula">Damage = ⌊ Coin Roll × (1 + Static) × (1 + Dynamic) ⌋ — at least 1, and at least 5% of the Coin Roll</div>
        <ul>
          <li>
            <strong>Coin Roll</strong> = the coin's Final Power: Base Power + Coin Power for every Heads so far in this attack (it adds up coin by coin) + Power Up style bonuses. Clash Power bonuses do <em>not</em> count.
          </li>
          <li>
            <strong>Static</strong> (added together): sin resistance + damage-type resistance + level advantage + Critical Hit (+0.2) + 0.03 × Clash count.
          </li>
          <li>
            <strong>Dynamic</strong> (added together): Damage Up / Down, Fragile, Protection, typed DMG Up / Fragility, passive and skill "+X% damage" effects, E.G.O Gifts, Crit DMG Up.
          </li>
          <li>Because Static and Dynamic multiply, a crit (+20%) on a target with 2 Fragile (+20%) deals ×1.44, not ×1.40.</li>
        </ul>
        <h3>Resistances</h3>
        <div className="formula">x ≥ 1: +(x − 1)  ·  0 &lt; x &lt; 1: +(x − 1) / 2  ·  x = 0 (Immune): −0.5</div>
        <p className="small">So Ineff. ×0.5 means −25% damage (not −50%), and Immune still takes half damage. Resistances cap at ×2 and cannot go below ×0. Resist Down adds +0.1 to the value per Count.</p>
        <h3>Offense vs Defense Level</h3>
        <div className="formula">Level advantage = (Off − Def) / (|Off − Def| + 25)</div>
        <p className="small">
          Off = attacker's Level + the skill's Offense modifier (+ Resonance, + Offense Level Up). Def = target's Level + Defense modifier, or the Defense skill's own level if it is guarding/evading. Examples: 3 levels →{" "}
          {Math.round(levelAdvantage(3, 0) * 100)}%, 9 → {Math.round(levelAdvantage(9, 0) * 100)}%, 20 → {Math.round(levelAdvantage(20, 0) * 100)}%.
        </p>
        <h3>Extra damage that ignores the formula</h3>
        <p className="small">Burn, Bleed and Rupture deal fixed damage: no resistances, no levels, no Protection. Sinking on units without SP, Tremor - Reverb and other "X-affinity damage" use only the sin resistance.</p>
        <Src page="Damage_Formula" />
      </Card>

      <Card>
        <h2 id="help-clash">Clashes</h2>
        <ul>
          <li>Each round both skills flip all their remaining coins. Clash Power = Final Power + Clash Power bonuses.</li>
          <li>The higher Offense/Defense Level gets <strong>+1 Clash Power per 3 levels</strong> of difference (rounded down).</li>
          <li>The lower side loses its first remaining coin. Ties lose nothing and flip again. At 99 rounds both skills are cancelled.</li>
          <li>The winner then attacks with its remaining coins, flipping them again. Each round of the Clash adds +3% damage to that attack.</li>
          <li><strong>Unbreakable coins</strong> crack instead of breaking. After losing, cracked coins still hit with Coin Power fixed to 1. <strong>Excision coins</strong> also destroy Unbreakable coins.</li>
          <li>A Sinner can redirect an enemy attack into a Clash if their Speed is higher, or if that attack targets them.</li>
          <li>The Clash odds shown while planning are exact for skills without conditional effects; the calculator runs the full engine.</li>
        </ul>
        <Src page="Skills" />
      </Card>

      <Card>
        <h2 id="help-coins">Coins &amp; custom coins</h2>
        <ul>
          <li><strong>Normal coins</strong> break when they lose a Clash round. <strong>Unbreakable</strong> coins crack instead and still hit after a lost Clash with Coin Power fixed to 1. <strong>Excision</strong> coins also destroy enemy Unbreakable coins.</li>
          <li>Every coin can be customised: its own Coin Power, damage type, sin, a Heads chance bonus, or always Heads / always Tails. A coin's own damage type and sin decide its resistances and typed buffs; resources and Resonance still follow the skill.</li>
          <li><strong>Multiply coins</strong> (named in the game files, unused by current kits): Final Power = (Base + every Heads add-coin) × every Heads multiplier, rounded down. Paralyze turns a multiplier into ×1.</li>
          <li><strong>Coin types</strong> (Builder → Coin types) are reusable custom coins: pick how they behave in a Clash, their power when cracked, whether Paralyze affects them, and rules every coin of that type carries. Any coin can still override a type's settings.</li>
          <li>Clash odds, power ranges and event checks all account for custom coins; the calculator and simulator run them through the full engine.</li>
        </ul>
        <Src page="Skills" />
      </Card>

      <Card>
        <h2 id="help-sanity">Sanity (SP)</h2>
        <div className="formula">Heads chance = 50% + SP   (SP is between −45 and +45; units without Sanity: 50%)</div>
        <ul>
          <li>Winning a Clash: +10 SP, +2 more per extra round (10, 12, 14…).</li>
          <li>Defeating an enemy of equal or higher level: +10 SP; allies get +5.</li>
          <li>An ally of equal or higher level dies: −10 SP (−10 more per level of difference).</li>
          <li>At −30 or lower: Low Morale. At −45: Panic at the next Turn Start (the Sinner does not act), then SP resets to 0.</li>
        </ul>
        <Src page="Sanity" />
      </Card>

      <Card>
        <h2 id="help-stagger">Stagger</h2>
        <ul>
          <li>Thresholds are % of max HP. Dropping to or below one (with no Shield) Staggers the unit.</li>
          <li>Staggered units cannot act for the rest of that turn and all of the next one.</li>
          <li>Their damage-type resistance becomes +1 (Stagger), +1.5 (Stagger+) or +2 (Stagger++); passing more thresholds in the same turn raises the level.</li>
          <li>Tremor Burst raises the next threshold by the Tremor Potency (in HP); if it rises above current HP, the unit is Staggered. Bleed damage cannot Stagger on its own.</li>
        </ul>
        <Src page="Battles" />
      </Card>

      <Card>
        <h2 id="help-turn">A turn, step by step</h2>
        <ol>
          <li><strong>Turn Start:</strong> "next turn" statuses arrive, Shields vanish, Panic is checked, Speed is rolled (range + Haste − Bind, at least 1), Turn Start effects run.</li>
          <li><strong>Skill Slots:</strong> from turn 2, one extra slot per turn in Deployment Order (up to 12 in chain battles; up to the deploy limit in focused fights). Enemies gain one per turn up to their max.</li>
          <li><strong>Planning:</strong> enemies pick skills; faster enemy slots aim at slower Sinners. You pick skills and targets.</li>
          <li><strong>Combat Start:</strong> E.G.O are paid for, Sin Resonance is counted, passives check their requirements, Clashes are paired.</li>
          <li><strong>Resolution:</strong> actions go from fastest to slowest Speed.</li>
          <li><strong>Turn End:</strong> Turn End effects, Burn damage, then Poise/Charge/Tremor lose 1 Count, one-turn statuses expire, and units Staggered last turn recover.</li>
        </ol>
        <p className="small">"Deck" mode draws skills from a shuffled list with 3 copies of Skill 1, 2 of Skill 2 and 1 of Skill 3 (Skill 3 from Uptie 3), refilled when empty.</p>
      </Card>

      <Card>
        <h2 id="help-defense">Defense skills</h2>
        <ul>
          <li><strong>Guard:</strong> when hit one-sided, adds Shield equal to its Final Power (+1 per 3 Defense Levels above the attacker's Offense Level). Once per turn.</li>
          <li><strong>Evade:</strong> rolls against every incoming coin; if Evade Power ≥ the coin's power, that hit is dodged. The first failure ends it.</li>
          <li><strong>Counter:</strong> after an attack on this unit ends, attacks back once per turn.</li>
          <li><strong>Clashable Guard / Counter:</strong> Clash with incoming one-sided attacks. A Clashable Guard that wins raises the attacker's Stagger Threshold by its Clash Power; when it loses it shrinks each incoming roll by its power.</li>
        </ul>
        <Src page="Skills" />
      </Card>

      <Card>
        <h2 id="help-resonance">Sin Resonance & passives</h2>
        <p>Skills of the same sin chosen in one turn resonate (ordered by Speed). Each skill gets an Offense/Defense Level bonus:</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Skill # in chain</th>
                {RESONANCE_BONUS.slice(0, 8).map((_, i) => (
                  <th key={i} className="num">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Resonance</td>
                {RESONANCE_BONUS.slice(0, 8).map((v, i) => (
                  <td key={i} className="num">{v ? `+${v}` : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Absolute Resonance (chain length)</td>
                {ABSOLUTE_RESONANCE_BONUS.slice(0, 8).map((v, i) => (
                  <td key={i} className="num">{v ? `+${v}` : "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">Absolute Resonance needs 3+ adjacent skills of one sin. A skill uses whichever bonus is higher. Passive requirements: "{SIN_LABEL.WRATH} ×3 Res" counts this turn's Wrath skills; "Owned" counts E.G.O resources. Every Attack Skill gives 1 resource of its sin on use.</p>
        <Src page="Sin_Resonance" />
      </Card>

      <Card>
        <h2 id="help-ego">E.G.O</h2>
        <ul>
          <li>Costs E.G.O resources and SP. After use, the Sinner takes on the E.G.O's sin resistances and its passive turns on next turn.</li>
          <li>Corrosion chance by SP after paying: 0% (0 to −22), 25% (−23 to −33), 75% (−34 to −44), 100% at −45.</li>
          <li>Overclock: ×1.5 resources and SP (rounded up) to use the Corrosion skill without hitting allies.</li>
        </ul>
        <Src page="E.G.O/Gameplay" label="E.G.O gameplay" />
      </Card>

      <Card>
        <h2 id="help-statuses">Status effects</h2>
        <p>"Next turn" statuses wait in the queue and land at the next Turn Start. Inflicting Potency on a unit without the status also gives it 1 Count (and vice versa).</p>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {[...keyword, ...general].map((d) => (
                <tr key={d.key}>
                  <td style={{ width: 170 }}>
                    <strong>{d.name}</strong>
                    <div className="small muted">{d.oneTurn ? "one turn" : "lasting"} · {d.polarity}</div>
                  </td>
                  <td>{d.description}</td>
                </tr>
              ))}
              {TREMOR_TYPES.map((t) => (
                <tr key={t}>
                  <td>
                    <strong>{TREMOR_TYPE_INFO[t].name}</strong>
                  </td>
                  <td>{TREMOR_TYPE_INFO[t].description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Damage-type and sin variants (e.g. Slash DMG Up, Wrath Fragility, Gloom Resist Down) work like their general versions but only for that type.</p>
        <Src page="Status_Effects" />
      </Card>

      <Card>
        <h2 id="help-gamedata">Game data from the wiki</h2>
        <ul>
          <li>
            <strong>Where from:</strong> the <a href={"https://limbuscompany.wiki.gg"} target="_blank" rel="noreferrer">Limbus Company Wiki</a>, licensed CC BY-SA 4.0 (wiki last updated {wikiDate}). Limbus Company belongs to Project Moon.
          </li>
          <li><strong>Included:</strong> {c ? `${c.identities} Identities, ${c.egos} E.G.O, ${c.enemies} enemy variants, ${c.gifts} E.G.O Gifts` : "Identities, E.G.O, enemies and E.G.O Gifts"}. Pick them anywhere you'd pick your own content ("From the game" tab).</li>
          <li>Identities use their Uptie 4 values; E.G.O use Threadspin IV values.</li>
          <li>Enemies list several variants (story, Mirror Dungeon…). Their HP scales with the level you set.</li>
          <li>Abnormality parts are Staggered by their own thresholds.</li>
          <li>
            <strong>Effects are converted from the wiki text automatically.</strong> About half become simulated rules{cov ? ` (Identities ${cov.identity}%, enemies ${cov.enemy}%, E.G.O ${cov.ego}%, gifts only ${cov.gift}%)` : ""}. The rest is shown as "Not simulated" notes and does nothing in a fight.
          </li>
          <li><strong>Want to fix something?</strong> Copy the item to your workshop; the copy is yours to edit, including its rules.</li>
        </ul>
      </Card>

      <Card>
        <h2 id="help-limits">What the simulator simplifies</h2>
        <p>The damage math, Clashes, coins, statuses and Stagger follow the wiki exactly. Some parts of a real fight are simplified — keep these in mind when reading battle results:</p>
        <ul>
          <li>Enemy AI: random skills (or your fixed rotation); faster enemy slots aim at slower Sinners. Real bosses often have hidden programming.</li>
          <li>The auto-planner for allies is a simple strategy, not an expert player.</li>
          <li>E.G.O Corrosion at −45 SP is treated as Panic (no action); Corroded E.G.O on use is rolled normally.</li>
          <li>Low Morale is applied every time SP is −30 or lower (the game says "a chance").</li>
          <li>Paralyze uses one Count per coin tossed (Clash rounds included).</li>
          <li>The level override changes Offense/Defense Level, and scales HP for enemies that have an "HP per level" value (all enemies from the game do).</li>
          <li>Skill Slot weight, Aggro, Assist attacks/defense, Duality and Joint Combo are not modelled.</li>
          <li>Effects you write as "Note only" are shown in text but not simulated.</li>
        </ul>
      </Card>
    </div>
  );
}
