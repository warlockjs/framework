/**
 * Keeps the code reference of the check docs page in step with
 * `GRIMOIRE_CODE_LIST`: the section between the `codes:start` and
 * `codes:end` markers must be exactly what the list renders to.
 *
 * After changing the list, rewrite the section with:
 * `GRIMOIRE_WRITE_CODES_DOCS=1 npx vitest run tests/check/codes-docs.spec.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GRIMOIRE_CODE_LIST, grimoireCodeDocsUrl } from "../../src/codes";
import type { GrimoireCodeArea } from "../../src/contracts";

const PAGE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/src/content/docs/v/latest/grimoire/guides/04-check.mdx",
);
const START = /\{\/\* codes:start[^*]*\*\/\}\n/;
const END = "{/* codes:end */}";

const AREA_HEADINGS: Record<GrimoireCodeArea, string> = {
  structure: "GR1xxx: written files",
  links: "GR2xxx: names that point at nothing",
  files: "GR3xxx: source files",
  tests: "GR4xxx: criteria and tests",
  apps: "GR5xxx: apps, pages and blocks",
  changelog: "GR6xxx: versions, changelogs and releases",
  tasks: "GR7xxx: tasks",
  book: "GR8xxx: building the book",
  usage: "GR9xxx: commands and queries",
};

/** Escape what MDX would read as JSX outside inline code. */
function mdxText(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(/[{}<>]/g, (char) => `\\${char}`)))
    .join("");
}

/** The generated section: one `## GRnxxx` heading per area and one `### GRnnnn` per code. */
function renderCodes(): string {
  const lines: string[] = [];
  let area: GrimoireCodeArea | null = null;

  for (const definition of GRIMOIRE_CODE_LIST) {
    if (definition.area !== area) {
      area = definition.area;
      lines.push(`## ${AREA_HEADINGS[area]}`, "");
    }

    lines.push(
      `### ${definition.code}`,
      "",
      `${mdxText(definition.title)}.`,
      "",
      `- **Severity:** ${definition.severity}`,
      `- **What to do:** ${mdxText(definition.fix)}`,
      `- **Skill:** \`${definition.skill}\``,
      "",
    );
  }

  // Blank lines around the section keep the markers out of the headings and lists.
  return `\n${lines.join("\n")}\n`;
}

function readSection(page: string): { before: string; section: string; after: string } {
  const start = START.exec(page);
  const end = page.indexOf(END);

  if (!start || end < start.index)
    throw new Error(`${PAGE} has no codes:start / codes:end markers`);

  const sectionStart = start.index + start[0].length;

  return {
    before: page.slice(0, sectionStart),
    section: page.slice(sectionStart, end),
    after: page.slice(end),
  };
}

describe("the check docs page", () => {
  it("lists every code of GRIMOIRE_CODE_LIST, as generated from the list", () => {
    const page = readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n");
    const { before, section, after } = readSection(page);
    const expected = renderCodes();

    if (process.env["GRIMOIRE_WRITE_CODES_DOCS"] === "1" && section !== expected) {
      writeFileSync(PAGE, before + expected + after);
    } else {
      expect(
        section,
        "run GRIMOIRE_WRITE_CODES_DOCS=1 npx vitest run tests/check/codes-docs.spec.ts",
      ).toBe(expected);
    }
  });

  it("gives each code the heading its docs anchor points at", () => {
    const page = readFileSync(PAGE, "utf8");
    const anchors = [...page.matchAll(/^### (GR\d{4})$/gm)].map((match) => match[1]);

    expect(anchors).toEqual(GRIMOIRE_CODE_LIST.map((definition) => definition.code));

    for (const definition of GRIMOIRE_CODE_LIST) {
      expect(grimoireCodeDocsUrl(definition.code)).toMatch(
        new RegExp(`/grimoire/guides/04-check/#${definition.code.toLowerCase()}$`),
      );
    }
  });
});
