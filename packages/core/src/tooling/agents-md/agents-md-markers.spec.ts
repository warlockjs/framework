import { describe, expect, it } from "vitest";
import { WarlockError } from "../../errors/warlock-error";
import { AGENTS_MD_END, AGENTS_MD_START, upsertGeneratedSection } from "./agents-md-markers";

function codeOf(task: () => unknown): string | undefined {
  try {
    task();
  } catch (error) {
    return error instanceof WarlockError ? error.code : "not-a-warlock-error";
  }

  return undefined;
}

describe("upsertGeneratedSection", () => {
  it("creates the markers and the section when there is no file", () => {
    expect(upsertGeneratedSection(undefined, "## Facts\n")).toBe(
      `${AGENTS_MD_START}\n## Facts\n${AGENTS_MD_END}\n`,
    );
  });

  it("appends after a blank line when the file has no markers, keeping its bytes", () => {
    const handWritten = "# My app\n\nRules written by hand.\n";
    const next = upsertGeneratedSection(handWritten, "generated");

    expect(next.startsWith(handWritten)).toBe(true);
    expect(next).toBe(`${handWritten}\n${AGENTS_MD_START}\ngenerated\n${AGENTS_MD_END}\n`);
  });

  it("adds the blank line itself when the file does not end with a newline", () => {
    expect(upsertGeneratedSection("# Notes", "x")).toBe(
      `# Notes\n\n${AGENTS_MD_START}\nx\n${AGENTS_MD_END}\n`,
    );
  });

  it("replaces only the bytes between the markers", () => {
    const before = "# Title\n\n  indented   spacing\t kept\n";
    const after = "\n\n## After the section\n\nno trailing newline";
    const existing = `${before}${AGENTS_MD_START}\nold facts\nmore\n${AGENTS_MD_END}${after}`;
    const next = upsertGeneratedSection(existing, "new facts");

    expect(next).toBe(`${before}${AGENTS_MD_START}\nnew facts\n${AGENTS_MD_END}${after}`);
  });

  it("keeps CRLF files CRLF and leaves the content around the markers untouched", () => {
    const before = "# Title\r\n\r\nhand\r\n";
    const after = "\r\ntail\r\n";
    const existing = `${before}${AGENTS_MD_START}\r\nold\r\n${AGENTS_MD_END}${after}`;
    const next = upsertGeneratedSection(existing, "line one\nline two\n");

    expect(next).toBe(
      `${before}${AGENTS_MD_START}\r\nline one\r\nline two\r\n${AGENTS_MD_END}${after}`,
    );
  });

  it("is idempotent: the same section twice gives the same bytes", () => {
    const once = upsertGeneratedSection("# Hand\n", "facts");

    expect(upsertGeneratedSection(once, "facts")).toBe(once);
  });

  it("refuses malformed markers with WL7501", () => {
    expect(codeOf(() => upsertGeneratedSection(`${AGENTS_MD_START}\nonly start`, "x"))).toBe(
      "WL7501",
    );
    expect(codeOf(() => upsertGeneratedSection(`only end\n${AGENTS_MD_END}`, "x"))).toBe("WL7501");
    expect(
      codeOf(() => upsertGeneratedSection(`${AGENTS_MD_END}\nx\n${AGENTS_MD_START}\n`, "x")),
    ).toBe("WL7501");
    expect(
      codeOf(() =>
        upsertGeneratedSection(
          `${AGENTS_MD_START}\na\n${AGENTS_MD_END}\n${AGENTS_MD_START}\nb\n${AGENTS_MD_END}\n`,
          "x",
        ),
      ),
    ).toBe("WL7501");
  });
});
