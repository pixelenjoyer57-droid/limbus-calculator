import type { ContentKind } from "../../data/schema";

export const KIND_INFO: Record<ContentKind, { label: string; plural: string; slug: string; icon: string; blurb: string }> = {
  identity: { label: "Identity", plural: "Identities", slug: "identities", icon: "star", blurb: "Sinner kits with skills and passives" },
  ego: { label: "E.G.O", plural: "E.G.O", slug: "egos", icon: "bolt", blurb: "Awakening & Corrosion skills" },
  enemy: { label: "Enemy", plural: "Enemies", slug: "enemies", icon: "swords", blurb: "Foes, bosses and multi-part Abnormalities" },
  encounter: { label: "Encounter", plural: "Encounters", slug: "encounters", icon: "flag", blurb: "Waves of enemies to fight" },
  event: { label: "Event", plural: "Events", slug: "events", icon: "dice", blurb: "Choice events with skill checks" },
  gift: { label: "E.G.O Gift", plural: "E.G.O Gifts", slug: "gifts", icon: "shield", blurb: "Team-wide passive items" },
  status: { label: "Custom status", plural: "Custom statuses", slug: "statuses", icon: "list", blurb: "Your own keywords and effects" },
  team: { label: "Team", plural: "Teams", slug: "teams", icon: "team", blurb: "Loadouts" },
};

export const SLUG_TO_KIND: Record<string, ContentKind> = Object.fromEntries(
  (Object.keys(KIND_INFO) as ContentKind[]).map((k) => [KIND_INFO[k].slug, k]),
) as Record<string, ContentKind>;
