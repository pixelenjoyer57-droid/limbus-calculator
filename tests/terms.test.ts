import { describe, expect, it } from "vitest";
import aboutRaw from "../src/features/about/AboutPage.tsx?raw";
import contributingRaw from "../.github/CONTRIBUTING.md?raw";
import readmeRaw from "../README.md?raw";
import formRaw from "../.github/ISSUE_TEMPLATE/suggestion.yml?raw";

const read = (t: string) => t.replace(/\s+/g, " ");
const about = read(aboutRaw);
const contributing = read(contributingRaw);
const readme = read(readmeRaw);
const form = read(formRaw);

const shared = [
  'We name you in public, for example in the changelog, only if you say yes. Otherwise it says "community suggestion".',
  "We keep only your display name, the channel and the date. Giving a name is optional.",
  "We may copy suggestions, bug reports and custom kits you post on Discord or GitHub into our private notes. We may read them with third-party AI tools to help plan the work.",
  "We keep your name while we consider the idea. We delete it from our notes on request. Your original post stays under Discord's or GitHub's own rules.",
  "Please leave personal details out of public comments.",
];

describe("suggestion handling text", () => {
  it("uses the same sentences on the About page and in Contributing", () => {
    for (const s of shared) {
      expect(about).toContain(s);
      expect(contributing).toContain(s);
    }
  });

  it("puts credit first in the new About paragraph", () => {
    expect(about.indexOf(shared[0])).toBeLessThan(about.indexOf(shared[1]));
    expect(about.indexOf(shared[1])).toBeLessThan(about.indexOf(shared[2]));
  });

  it("says how to ask, and that the app sends nothing of yours", () => {
    expect(about).toContain("message a Discord moderator or comment on your <Ext to={ISSUES}>GitHub issue</Ext>");
    expect(about).toContain("The app does not send your workshops or data anywhere. See Privacy above for the host's logs.");
  });

  it("keeps new sentences short and adds no heading", () => {
    const start = about.indexOf(shared[0]);
    const para = about.slice(start, about.indexOf("</p>", start)).replace(/<[^>]+>/g, "");
    for (const sentence of para.split(/(?<=\.)\s+/)) {
      expect(sentence.split(" ").length).toBeLessThanOrEqual(25);
    }
    expect(about.match(/<h2/g)).toHaveLength(6);
  });

  it("drops old wording everywhere", () => {
    for (const t of [about, contributing, readme, form]) {
      expect(t).not.toMatch(/credit on request|credit obligation|sends nothing anywhere/i);
    }
  });

  it("adds the AI-assisted code line, the README pointer and keeps the form checkbox required", () => {
    expect(contributing).toContain("You are responsible for AI-assisted code too, and you confirm you may submit it.");
    expect(readme).toContain("[contributing guide](.github/CONTRIBUTING.md)");
    expect(form).toContain("I allow it to be used in the app without payment. I am not posting leaks");
    expect(form).toContain("required: true");
  });
});
