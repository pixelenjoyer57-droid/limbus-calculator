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
    const end = about.indexOf("<strong>Rights holders:</strong>", start);
    const para = about.slice(start, end).replace(/<[^>]+>/g, "");
    for (const sentence of para.split(/(?<=\.)\s+/)) {
      expect(sentence.split(" ").length).toBeLessThanOrEqual(25);
    }
    expect(about.match(/<h2/g)).toHaveLength(6);
  });

  it("splits the handling text into exactly three paragraphs", () => {
    const start = about.indexOf(shared[0]);
    const end = about.indexOf("<strong>Rights holders:</strong>", start);
    const block = "<p> " + about.slice(start, end);
    expect(block.match(/<p>/g)).toHaveLength(4); // three handling paragraphs plus the Rights holders one
    expect(block.match(/<\/p>/g)).toHaveLength(3);
    const paras = block.split("</p>").map((p) => p.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    expect(paras[0].startsWith("We name you in public")).toBe(true);
    expect(paras[0].endsWith("Giving a name is optional.")).toBe(true);
    expect(paras[1].startsWith("We may copy")).toBe(true);
    expect(paras[2].startsWith("To ask us to name you")).toBe(true);
    expect(about).toContain("comment on your <Ext to={ISSUES}>GitHub issue</Ext>. Please leave personal details");
  });

  it("links the contributing guide from the form and keeps the checkbox as it was", () => {
    expect(form).toContain(
      "How we handle suggestions (credit, private notes, deleting your name) is in the [contributing guide](https://github.com/pixelenjoyer57-droid/limbus-calculator/blob/main/.github/CONTRIBUTING.md).",
    );
    expect(form).toContain(
      "- label: I made this suggestion myself or may share it. I allow it to be used in the app without payment. I am not posting leaks or unreleased game material. required: true",
    );
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
