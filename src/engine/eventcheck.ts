// Event Skill Checks (Check Events page): the chosen Sinner flips the skill with
// the best chance; Sin affinity advantages lower the target number and some
// checks add bonuses for specific Sinners or factions.
import { binomPmf, headsChance } from "./formulas";
import type { EventChoice, Identity } from "../data/schema";

export interface CheckOdds {
  chance: number;
  skillName: string;
  target: number;
  label: "Very high" | "High" | "Normal" | "Low" | "Very low";
}

export function checkOdds(choice: EventChoice, idn: Identity, sp: number, uptie = 4): CheckOdds {
  let best: CheckOdds = { chance: 0, skillName: "-", target: choice.checkTarget, label: "Very low" };
  const bonus = choice.bonuses.reduce((a, b) => {
    const hit = b.match === "sinner" ? idn.sinner === b.value : idn.traits.some((t) => t.toLowerCase() === b.value.toLowerCase());
    return a + (hit ? b.amount : 0);
  }, 0);
  const p = headsChance(sp, true);
  idn.skills.forEach((s, i) => {
    if (i === 2 && uptie < 3) return;
    const adv = s.sin && choice.advantageSins.includes(s.sin) ? choice.advantageAmount : 0;
    const n = s.coins.length;
    let chance = 0;
    for (let h = 0; h <= n; h++) {
      const final = Math.max(0, s.basePower + s.coinPower * h) + bonus;
      const ok = choice.checkAtMost ? final <= choice.checkTarget + adv : final >= choice.checkTarget - adv;
      if (ok) chance += binomPmf(n, p, h);
    }
    if (chance > best.chance) best = { chance, skillName: s.name, target: choice.checkAtMost ? choice.checkTarget + adv : choice.checkTarget - adv, label: label(chance) };
  });
  best.label = label(best.chance);
  return best;
}

function label(c: number): CheckOdds["label"] {
  if (c >= 0.8) return "Very high";
  if (c >= 0.6) return "High";
  if (c >= 0.4) return "Normal";
  if (c >= 0.2) return "Low";
  return "Very low";
}
