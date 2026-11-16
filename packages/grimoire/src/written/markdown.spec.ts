import { describe, expect, it } from "vitest";
import type { GrimoireFinding } from "../contracts/findings";
import {
  checkHeadings,
  logicalLines,
  paragraphAfterTitle,
  readDocument,
  splitLines,
  textAfterTitle,
} from "./markdown";
import { FindingSink } from "./sink";

const FILE = "grimoire/features/catalog/flows/wishlist.md";

function sinkWith(): { sink: FindingSink; findings: GrimoireFinding[] } {
  const findings: GrimoireFinding[] = [];

  return {
    sink: new FindingSink(findings, { feature: "catalog", flow: "catalog/wishlist" }),
    findings,
  };
}

describe("splitLines", () => {
  it("splits on LF, CRLF and a lone CR, and drops a BOM", () => {
    expect(splitLines("\uFEFFa\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("readDocument", () => {
  it("reads the front matter, the title and the ## sections with file lines", () => {
    const { sink, findings } = sinkWith();
    const document = readDocument(
      FILE,
      [
        "---",
        "id: wishlist",
        "---",
        "",
        "# Save   ",
        "",
        "## Steps  ",
        "1. page   /x",
        "",
        "## Cases",
        "- a   b",
      ].join("\r\n"),
      "required",
      sink,
    );

    expect(findings).toEqual([]);
    expect(document.fields?.get("id")?.value).toBe("wishlist");
    expect(document.bodyStartLine).toBe(4);
    expect(document.title).toEqual({ level: 1, text: "Save", line: 5 });
    expect(document.sections.map((section) => [section.title, section.key, section.line])).toEqual([
      ["Steps", "steps", 7],
      ["Cases", "cases", 10],
    ]);
    expect(document.sections[0]?.lines.map((line) => line.text)).toEqual(["1. page   /x", ""]);
  });

  it("does not read headings inside code fences", () => {
    const { sink } = sinkWith();
    const document = readDocument(
      FILE,
      ["# T", "```md", "## Not a heading", "```", "## Real"].join("\n"),
      "none",
      sink,
    );

    expect(document.sections.map((section) => section.title)).toEqual(["Real"]);
    expect(document.body.filter((line) => line.fenced).map((line) => line.line)).toEqual([2, 3, 4]);
  });

  it("reports GR1001 for a required front matter that is missing, at line 1, with the subject", () => {
    const { sink, findings } = sinkWith();

    readDocument(FILE, "# Title\n", "required", sink);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "GR1001",
      at: { file: FILE, line: 1, column: null },
      subject: { feature: "catalog", flow: "catalog/wishlist", file: FILE },
    });
  });

  it("passes GR1002 from the front matter reader with the subject filled", () => {
    const { sink, findings } = sinkWith();

    readDocument(FILE, "---\nid wishlist\n---\n# T\n", "required", sink);

    expect(
      findings.map((finding) => [finding.code, finding.at?.line, finding.subject.flow]),
    ).toEqual([["GR1002", 2, "catalog/wishlist"]]);
  });

  it("treats an unclosed `---` rule as body text in a file whose template has no front matter", () => {
    const { sink, findings } = sinkWith();
    const document = readDocument(FILE, "---\n# Brief\n", "none", sink);

    expect(findings).toEqual([]);
    expect(document.fields).toBeNull();
    expect(document.title?.text).toBe("Brief");
  });
});

describe("checkHeadings", () => {
  it("reports missing required headings (GR1006) and unknown or repeated ones (GR1007)", () => {
    const { sink, findings } = sinkWith();
    const document = readDocument(
      FILE,
      ["## Steps", "## Notes", "## steps"].join("\n"),
      "none",
      sink,
    );

    checkHeadings(
      document,
      { title: true, required: ["Steps", "Cases"], optional: ["Not handled"] },
      sink,
    );

    expect(findings.map((finding) => [finding.code, finding.at?.line, finding.message])).toEqual([
      ["GR1006", 1, "The file has no `# ` title heading."],
      ["GR1006", 1, 'The heading "## Cases" is missing.'],
      ["GR1007", 2, 'The heading "## Notes" is not part of the template.'],
      ["GR1007", 3, 'The heading "## steps" is written twice; only the first is read.'],
    ]);
  });
});

describe("logicalLines", () => {
  it("joins indented continuation lines and starts a new line at each item", () => {
    const { sink } = sinkWith();
    const document = readDocument(
      FILE,
      ["- a   one", "      two", "  - b   nested", "", "    after a blank", "* c\tthree"].join(
        "\n",
      ),
      "none",
      sink,
    );

    expect(logicalLines(document.body)).toEqual([
      { text: "- a   one two", line: 1 },
      { text: "- b   nested", line: 3 },
      { text: "after a blank", line: 5 },
      { text: "* c\tthree", line: 6 },
    ]);
  });
});

describe("paragraphs", () => {
  it("reads the first paragraph after the title and the text after it", () => {
    const { sink } = sinkWith();
    const document = readDocument(
      FILE,
      ["# T", "", "One", "two", "", "Three", "## H", "x"].join("\n"),
      "none",
      sink,
    );

    expect(paragraphAfterTitle(document)).toBe("One two");
    expect(textAfterTitle(document, 6)).toBe("One\ntwo");
  });

  it("has no paragraph when a heading follows the title", () => {
    const { sink } = sinkWith();

    expect(paragraphAfterTitle(readDocument(FILE, "# T\n## H\nx", "none", sink))).toBeNull();
  });
});
