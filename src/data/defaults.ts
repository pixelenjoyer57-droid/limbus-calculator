// Factories for new content, quick-start templates and the starter workspace.
import { DEFAULT_DECK_AMOUNT, SINNERS, SINS, type Sinner } from "../engine/constants";
import {
  newCoin, newId, zCoinType, zCustomStatus, zEgo, zEncounter, zEnemy, zEventChoice, zGameEvent, zGift, zIdentity, zOutcome, zPassive,
  zSkill, zTeam, zWorkspace, val, type CoinType, type CustomStatus, type Ego, type Encounter, type Enemy, type GameEvent, type Gift,
  type Identity, type Skill, type Team, type Workspace,
} from "./schema";
import { act, cond, eff, give, inflict, mod, onCoin, per, q, skill } from "./build";

const now = () => Date.now();
const stamp = <T extends { createdAt: number; updatedAt: number }>(x: T): T => ({ ...x, createdAt: now(), updatedAt: now() });

export function newSkill(partial: Partial<Skill> = {}): Skill {
  return zSkill.parse({ id: newId(), ...partial });
}

export function newIdentity(partial: Partial<Identity> = {}): Identity {
  return stamp(
    zIdentity.parse({
      id: newId(),
      name: "New Identity",
      staggerThresholds: [65, 35, 15],
      skills: [
        newSkill({ name: "Skill 1", sin: "WRATH", dmgType: "SLASH", basePower: 4, coinPower: 4, coins: [newCoin(), newCoin()], amount: DEFAULT_DECK_AMOUNT.S1 }),
        newSkill({ name: "Skill 2", sin: "LUST", dmgType: "PIERCE", basePower: 5, coinPower: 4, coins: [newCoin(), newCoin()], amount: DEFAULT_DECK_AMOUNT.S2 }),
        newSkill({ name: "Skill 3", sin: "PRIDE", dmgType: "BLUNT", basePower: 6, coinPower: 3, coins: [newCoin(), newCoin(), newCoin()], amount: DEFAULT_DECK_AMOUNT.S3 }),
      ],
      defense: [newSkill({ name: "Guard", kind: "guard", sin: null, basePower: 7, coinPower: 3, levelMod: -2, amount: 0 })],
      passives: [
        zPassive.parse({ id: newId(), name: "Combat Passive", kind: "combat", reqMode: "res", reqSin: "WRATH", reqCount: 3 }),
        zPassive.parse({ id: newId(), name: "Support Passive", kind: "support", reqMode: "owned", reqSin: "LUST", reqCount: 3 }),
      ],
      ...partial,
    }),
  );
}

export function newEgo(partial: Partial<Ego> = {}): Ego {
  return stamp(
    zEgo.parse({
      id: newId(),
      name: "New E.G.O",
      grade: "TETH",
      cost: { ...Object.fromEntries(SINS.map((s) => [s, 0])), WRATH: 3 },
      spCost: 15,
      awakening: newSkill({ name: "Awakening", sin: "WRATH", dmgType: "SLASH", basePower: 14, coinPower: 6, coins: [newCoin()], amount: 0 }),
      corrosion: null,
      passive: null,
      ...partial,
    }),
  );
}

export function newEnemy(partial: Partial<Enemy> = {}): Enemy {
  return stamp(
    zEnemy.parse({
      id: newId(),
      name: "New Enemy",
      staggerThresholds: [50],
      skills: [newSkill({ name: "Strike", sin: "WRATH", dmgType: "SLASH", basePower: 4, coinPower: 4, coins: [newCoin(), newCoin()], amount: 0 })],
      ...partial,
    }),
  );
}

export function newEncounter(partial: Partial<Encounter> = {}): Encounter {
  return stamp(zEncounter.parse({ id: newId(), waves: [{ id: newId(), enemies: [] }], ...partial }));
}

export function newGift(partial: Partial<Gift> = {}): Gift {
  return stamp(zGift.parse({ id: newId(), ...partial }));
}

export function newStatus(partial: Partial<CustomStatus> = {}): CustomStatus {
  return stamp(zCustomStatus.parse({ id: newId(), key: "CUSTOM_" + newId().replace(/-/g, "").slice(0, 10).toUpperCase(), ...partial }));
}

export function newCoinType(partial: Partial<CoinType> = {}): CoinType {
  return stamp(zCoinType.parse({ id: newId(), key: "COIN_" + newId().replace(/-/g, "").slice(0, 10).toUpperCase(), ...partial }));
}

export function newEvent(partial: Partial<GameEvent> = {}): GameEvent {
  return stamp(
    zGameEvent.parse({
      id: newId(),
      choices: [zEventChoice.parse({ id: newId(), label: "Leave", success: [zOutcome.parse({ id: newId(), kind: "text", text: "Nothing happens." })] })],
      ...partial,
    }),
  );
}

export function newTeam(partial: Partial<Team> = {}): Team {
  return stamp(zTeam.parse({ id: newId(), ...partial }));
}

export function emptyWorkspace(name = "My Workshop"): Workspace {
  return zWorkspace.parse({ id: newId(), name, createdAt: now(), updatedAt: now() });
}

// ---------------------------------------------------------------------------------
// Templates offered by "+ New" (so nobody starts from a blank page)
// ---------------------------------------------------------------------------------
export interface Template<T> {
  id: string;
  name: string;
  blurb: string;
  make: () => T;
}

export const IDENTITY_TEMPLATES: Template<Identity>[] = [
  { id: "blank", name: "Basic kit", blurb: "Three plain attacks and a Guard. No effects yet.", make: () => newIdentity() },
  { id: "burn", name: "Burn attacker", blurb: "Wrath skills that stack Burn, with a Burn payoff on Skill 3.", make: () => burnIdentity("Yi Sang") },
  { id: "bleed", name: "Bleed duelist", blurb: "Lust skills that inflict Bleed Potency and Count.", make: () => bleedIdentity("Rodion") },
  { id: "poise", name: "Poise crit", blurb: "Pride skills that build Poise and hit harder on crits.", make: () => poiseIdentity("Outis") },
  { id: "tremor", name: "Tremor tank", blurb: "Sloth Blunt skills, Tremor Burst and a Clashable Guard.", make: () => tremorIdentity("Ishmael") },
];

export const ENEMY_TEMPLATES: Template<Enemy>[] = [
  { id: "blank", name: "Basic enemy", blurb: "One simple attack.", make: () => newEnemy() },
  { id: "dummy", name: "Training dummy", blurb: "Lots of HP, no skills, no Sanity. Great for pure damage tests.", make: () => dummy() },
  { id: "brute", name: "Brawler", blurb: "A human enemy with Sanity, two skills and two Stagger Thresholds.", make: () => brute() },
  { id: "parts", name: "Multi-part Abnormality", blurb: "A Focused Encounter boss with a Core and two Parts.", make: () => lantern() },
];

// ---------------------------------------------------------------------------------
// Example content (original kits used by the starter workspace and templates)
// ---------------------------------------------------------------------------------
function burnIdentity(sinner: Sinner): Identity {
  const s1 = onCoin(skill("Kindle", "WRATH", "SLASH", 4, 4, 2, { amount: 3 }), 0, eff("onHit", [inflict("BURN", 1)]));
  const s2 = onCoin(
    onCoin(skill("Flare Step", "LUST", "PIERCE", 5, 4, 2, { amount: 2 }), 0, eff("onHit", [inflict("BURN", 2)])),
    1,
    eff("headsHit", [inflict("BURN", 0, 1)]),
  );
  const s3 = skill("Pyre", "WRATH", "SLASH", 6, 3, 3, {
    amount: 1,
    levelMod: 2,
    effects: [eff("onUse", [act("mod", { stat: "basePower", who: "self", amount: per(q("statusPotency", { who: "target", status: "BURN" }), 3, 1, 3) })])],
  });
  onCoin(s3, 2, eff("onHit", [inflict("BURN", 3, 1)]));
  return newIdentity({
    name: "Cinder Courier",
    sinner,
    hp: 214,
    speedMin: 4,
    speedMax: 7,
    defenseMod: -2,
    staggerThresholds: [65, 35, 15],
    resist: { SLASH: 1, PIERCE: 2, BLUNT: 0.5 },
    traits: ["Example"],
    skills: [s1, s2, s3],
    defense: [newSkill({ name: "Sidestep", kind: "evade", sin: "WRATH", basePower: 4, coinPower: 4, levelMod: 1, amount: 0 })],
    passives: [
      zPassive.parse({
        id: newId(), name: "Embers Linger", kind: "combat", reqMode: "res", reqSin: "WRATH", reqCount: 3,
        effects: [eff("always", [mod("dmgDealt", 10)], [cond("compare", { q: q("statusPotency", { who: "target", status: "BURN" }), op: ">=", value: 5 })])],
      }),
      zPassive.parse({
        id: newId(), name: "Warm Hands", kind: "support", reqMode: "owned", reqSin: "WRATH", reqCount: 3,
        effects: [eff("turnStart", [inflict("BURN", 1, 0, "randomEnemy")])],
      }),
    ],
    notes: "Example kit. Burn stacks on every hit; Pyre gains Base Power from the target's Burn.",
  });
}

function bleedIdentity(sinner: Sinner): Identity {
  const s1 = onCoin(skill("Nick", "LUST", "SLASH", 3, 4, 2, { amount: 3 }), 1, eff("onHit", [inflict("BLEED", 2)]));
  const s2 = skill("Hamstring", "GLUTTONY", "SLASH", 4, 4, 2, { amount: 2 });
  onCoin(s2, 0, eff("onHit", [inflict("BLEED", 1, 1)]));
  onCoin(s2, 1, eff("onHit", [inflict("BLEED", 0, 2)]));
  const s3 = skill("Red Ribbon", "LUST", "SLASH", 5, 3, 4, {
    amount: 1,
    effects: [eff("always", [mod("dmgDealt", per(q("statusPotency", { who: "target", status: "BLEED" }), 1, 2, 30))])],
  });
  onCoin(s3, 3, eff("onHit", [inflict("BLEED", 3, 2)]));
  return newIdentity({
    name: "Thornbound Fencer",
    sinner,
    hp: 198,
    speedMin: 4,
    speedMax: 8,
    defenseMod: -3,
    staggerThresholds: [60, 30],
    resist: { SLASH: 0.5, PIERCE: 1.5, BLUNT: 1 },
    traits: ["Example"],
    skills: [s1, s2, s3],
    defense: [newSkill({ name: "Riposte", kind: "counter", sin: "LUST", dmgType: "SLASH", basePower: 5, coinPower: 4, amount: 0 })],
    passives: [
      zPassive.parse({
        id: newId(), name: "Open Wounds", kind: "combat", reqMode: "owned", reqSin: "LUST", reqCount: 3,
        effects: [eff("onHitDealt", [inflict("BLEED", 0, 1)], [cond("hasStatus", { who: "target", status: "BLEED" })], { perTurn: 2 })],
      }),
    ],
    notes: "Example kit. Red Ribbon deals +2% damage per Bleed Potency on the target (max +30%).",
  });
}

function poiseIdentity(sinner: Sinner): Identity {
  const s1 = onCoin(skill("Quickdraw", "PRIDE", "PIERCE", 3, 4, 2, { amount: 3 }), 0, eff("onHit", [inflict("POISE", 1, 0, "self")]));
  const s2 = onCoin(skill("Steady Aim", "ENVY", "PIERCE", 4, 5, 2, { amount: 2 }), 1, eff("onHit", [inflict("POISE", 2, 1, "self")]));
  const s3 = skill("Final Round", "PRIDE", "PIERCE", 5, 4, 3, {
    amount: 1,
    effects: [eff("onUse", [inflict("POISE", 0, 3, "self")]), eff("always", [mod("critDmg", 30)])],
  });
  onCoin(s3, 2, eff("onCrit", [give("FRAGILE", 2, "target", "nextTurn")]));
  return newIdentity({
    name: "Gunlight Agent",
    sinner,
    hp: 205,
    speedMin: 3,
    speedMax: 7,
    defenseMod: -1,
    staggerThresholds: [65, 35],
    resist: { SLASH: 1.5, PIERCE: 0.5, BLUNT: 1 },
    traits: ["Example"],
    skills: [s1, s2, s3],
    defense: [newSkill({ name: "Brace", kind: "guard", sin: "PRIDE", basePower: 8, coinPower: 3, levelMod: 2, amount: 0 })],
    passives: [
      zPassive.parse({
        id: newId(), name: "Dead Eye", kind: "combat", reqMode: "res", reqSin: "PRIDE", reqCount: 2,
        effects: [eff("combatStart", [inflict("POISE", 2, 0, "self")])],
      }),
    ],
    notes: "Example kit. Final Round adds 3 Poise Count, deals +30% damage on crits and inflicts Fragile next turn on a crit.",
  });
}

function tremorIdentity(sinner: Sinner): Identity {
  const s1 = onCoin(skill("Undertow", "SLOTH", "BLUNT", 4, 3, 2, { amount: 3 }), 0, eff("onHit", [inflict("TREMOR", 1, 1)]));
  const s2 = onCoin(skill("Breaker", "GLOOM", "BLUNT", 5, 3, 2, { amount: 2 }), 1, eff("onHit", [inflict("TREMOR", 0, 2)]));
  const s3 = onCoin(skill("Riptide", "SLOTH", "BLUNT", 7, 2, 3, { amount: 1, levelMod: -1 }), 2, eff("onHit", [act("tremorBurst", { who: "target", amount: val(1) })]));
  return newIdentity({
    name: "Tidecaller",
    sinner,
    hp: 262,
    hpPerLevel: 3.6,
    speedMin: 2,
    speedMax: 5,
    defenseMod: 2,
    staggerThresholds: [50, 25],
    resist: { SLASH: 0.75, PIERCE: 1, BLUNT: 1.5 },
    traits: ["Example"],
    skills: [s1, s2, s3],
    defense: [newSkill({ name: "Seawall", kind: "guard", clashable: true, sin: "SLOTH", basePower: 9, coinPower: 4, levelMod: 3, amount: 0 })],
    passives: [
      zPassive.parse({
        id: newId(), name: "Breakwater", kind: "combat", reqMode: "owned", reqSin: "SLOTH", reqCount: 3,
        effects: [eff("always", [mod("dmgTaken", -10)])],
      }),
    ],
    notes: "Example kit. Riptide's last coin triggers Tremor Burst. Seawall is a Clashable Guard.",
  });
}

function dummy(): Enemy {
  return newEnemy({
    name: "Training Dummy",
    level: 65,
    hp: 5000,
    hasSanity: false,
    speedMin: 1,
    speedMax: 1,
    staggerThresholds: [],
    slots: 0,
    slotsMax: 0,
    skills: [],
    notes: "Does nothing. Use it to measure damage.",
  });
}

function brute(): Enemy {
  return newEnemy({
    name: "Back-alley Brawler",
    level: 63,
    hp: 640,
    speedMin: 2,
    speedMax: 5,
    defenseMod: -1,
    staggerThresholds: [60, 30],
    resist: { SLASH: 1.5, PIERCE: 1, BLUNT: 0.75 },
    sinResist: { WRATH: 1, LUST: 1, SLOTH: 0.75, GLUTTONY: 1, GLOOM: 1.5, PRIDE: 1, ENVY: 1 },
    slots: 1,
    slotsMax: 2,
    skills: [
      skill("Haymaker", "ENVY", "BLUNT", 5, 3, 2),
      onCoin(skill("Bottle Swing", "WRATH", "SLASH", 3, 5, 2), 1, eff("onHit", [inflict("BLEED", 1, 1)])),
    ],
  });
}

function lantern(): Enemy {
  return newEnemy({
    name: "Hollow Lantern",
    level: 65,
    hp: 2600,
    hasSanity: false,
    speedMin: 2,
    speedMax: 6,
    staggerThresholds: [50],
    resist: { SLASH: 1, PIERCE: 1, BLUNT: 1 },
    sinResist: { WRATH: 0.5, LUST: 1, SLOTH: 1, GLUTTONY: 1.5, GLOOM: 2, PRIDE: 1, ENVY: 1 },
    skills: [],
    parts: [
      {
        id: newId(), name: "Wick", hp: 700, defenseMod: -2, resist: { SLASH: 2, PIERCE: 1, BLUNT: 0.5 },
        sinResist: { WRATH: 0.5, LUST: 1, SLOTH: 1, GLUTTONY: 1.5, GLOOM: 2, PRIDE: 1, ENVY: 1 },
        breakable: "destructible", slots: 1, hpPerLevel: 0, speedMin: null, speedMax: null, staggerThresholds: [],
        skills: [onCoin(skill("Flicker", "GLOOM", "PIERCE", 4, 4, 2), 0, eff("onHit", [inflict("SINKING", 2, 1)]))],
      },
      {
        id: newId(), name: "Glass Shell", hp: 1100, defenseMod: 3, resist: { SLASH: 0.5, PIERCE: 0.75, BLUNT: 2 },
        sinResist: { WRATH: 0.5, LUST: 1, SLOTH: 1, GLUTTONY: 1.5, GLOOM: 2, PRIDE: 1, ENVY: 1 },
        breakable: "indestructible", slots: 1, hpPerLevel: 0, speedMin: null, speedMax: null, staggerThresholds: [],
        skills: [skill("Shatterwave", "SLOTH", "BLUNT", 6, 3, 3, { atkWeight: 3 })],
      },
    ],
    notes: "Example multi-part enemy: damage to a Part also hits the Core HP. The Wick breaks; the Shell recovers.",
  });
}

export function sampleWorkspace(): Workspace {
  const ws = emptyWorkspace("Example Workshop");
  const ids = [burnIdentity("Yi Sang"), bleedIdentity("Rodion"), poiseIdentity("Outis"), tremorIdentity("Ishmael")];
  const ember = newCoinType({
    name: "Ember Coin",
    color: "#ff7a3d",
    clash: "unbreakable",
    crackedPower: 2,
    headsBonus: 10,
    description: "Example custom coin: cracks instead of breaking (hits for 2 when cracked), +10% Heads, and every hit inflicts 1 Burn.",
    effects: [eff("onHit", [inflict("BURN", 1)])],
  });
  ws.coinTypes.push(ember);
  // Cinder Courier's Skill 3 ends on an Ember Coin
  const pyreLast = ids[0].skills[2].coins[2];
  pyreLast.customType = ember.key;
  pyreLast.kind = "unbreakable";
  ws.identities.push(...ids);
  const scorch = newStatus({
    name: "Scorchmark",
    polarity: "negative",
    mode: "value",
    maxCount: 5,
    turnEnd: "countMinus1",
    description: "Take +5% damage per stack (max 5). Loses 1 stack at Turn End.",
  });
  scorch.effects = [eff("always", [mod("dmgTaken", per(q("statusCount", { who: "self", status: scorch.key }), 1, 5))])];
  ws.statuses.push(scorch);
  const ego = newEgo({
    name: "Hearthfire",
    sinner: "Yi Sang",
    grade: "TETH",
    cost: { ...Object.fromEntries(SINS.map((s) => [s, 0])), WRATH: 3, LUST: 1 } as Ego["cost"],
    spCost: 15,
    sinResist: { WRATH: 0.5, LUST: 1, SLOTH: 1.5, GLUTTONY: 1, GLOOM: 1.5, PRIDE: 1, ENVY: 0.75 },
    awakening: onCoin(skill("Hearthfire", "WRATH", "SLASH", 18, 6, 2, { atkWeight: 2, amount: 0, levelMod: 3 }), 1, eff("onHit", [inflict("BURN", 3, 2), give(scorch.key, 2)])),
  });
  ws.egos.push(ego);
  const enemies = [dummy(), brute(), lantern()];
  ws.enemies.push(...enemies);
  ws.encounters.push(
    newEncounter({ name: "Back Alley Scuffle", type: "normal", waves: [{ id: newId(), enemies: [{ enemyId: enemies[1].id, count: 2, level: 0, slots: 0 }] }] }),
    newEncounter({ name: "Lantern Hunt", type: "abnormality", maxDeploy: 5, waves: [{ id: newId(), enemies: [{ enemyId: enemies[2].id, count: 1, level: 0, slots: 0 }] }] }),
  );
  const charm = newGift({
    name: "Smoldering Charm",
    tier: "I",
    keyword: "BURN",
    cost: 150,
    effects: [eff("onHitDealt", [inflict("BURN", 1)], [cond("skillInflicts", { status: "BURN" }), cond("targetIsEnemy")], { perTurn: 1 })],
    plus1: [eff("onHitDealt", [inflict("BURN", 2)], [cond("skillInflicts", { status: "BURN" }), cond("targetIsEnemy")], { perTurn: 1 })],
    notes: "When hitting an enemy with a skill that inflicts Burn, inflict +1 Burn (once per Sinner per turn). +: 2 Burn.",
  });
  const knuckles = newGift({
    name: "Brass Knuckle Ring",
    tier: "II",
    keyword: "BLUNT",
    cost: 190,
    effects: [eff("always", [mod("dmgDealt", 10, { dmgType: "BLUNT" })])],
    notes: "Blunt skills deal +10% damage.",
  });
  ws.gifts.push(charm, knuckles);
  ws.events.push(
    newEvent({
      name: "Abandoned Furnace",
      intro: "A furnace still glows in the ruins. Something glints between the coals.",
      choices: [
        zEventChoice.parse({
          id: newId(),
          label: "Reach into the embers",
          hasCheck: true,
          checkTarget: 14,
          advantageSins: ["WRATH"],
          advantageAmount: 3,
          success: [zOutcome.parse({ id: newId(), kind: "gift", target: "all", giftId: charm.id, text: "You pull out a warm charm." })],
          failure: [zOutcome.parse({ id: newId(), kind: "hp", target: "chosen", amount: -20, pct: true, text: "Burnt fingers." })],
        }),
        zEventChoice.parse({ id: newId(), label: "Walk away", success: [zOutcome.parse({ id: newId(), kind: "sp", target: "all", amount: 5, text: "A moment of calm." })] }),
      ],
    }),
  );
  const team = newTeam({ name: "Example Team" });
  const order: Sinner[] = ["Yi Sang", "Rodion", "Outis", "Ishmael"];
  ids.forEach((idn, i) => {
    team.members[order[i]] = { identityId: idn.id, level: 65, uptie: 4, egos: { ZAYIN: null, TETH: i === 0 ? ego.id : null, HE: null, WAW: null, ALEPH: null } };
  });
  team.deploy = [...order];
  ws.teams.push(team);
  return ws;
}

export const ALL_SINNERS = SINNERS;
