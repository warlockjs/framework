import { describe, expect, it } from "vitest";
import { scanShowsInText } from "./scan-shows";

const FILE = "e2e/shows.e2e.ts";
const known = new Map([["contact/send-message", new Set(["AC-1", "AC-2"])]]);

function scan(text: string) {
  const result = scanShowsInText(text, FILE, known);

  return {
    shows: result.shows.map((line) => `${line.ref} ${line.criterion} call:${line.call?.line ?? "none"}`),
    codes: result.findings.map((finding) => `${finding.code}:${finding.at?.line}`),
  };
}

describe("scanShowsInText", () => {
  it("reads a line directly above its shows() call", () => {
    expect(
      scan(
        [
          "// @shows contact/send-message AC-1",
          'await shows(context, "contact/send-message AC-1", async () => {});',
        ].join("\n"),
      ),
    ).toEqual({ shows: ["contact/send-message AC-1 call:2"], codes: [] });
  });

  it("reads a call whose arguments span lines, after blank and comment lines", () => {
    expect(
      scan(
        [
          "// @shows contact/send-message AC-2",
          "",
          "// the second scene",
          "await shows(",
          "  context,",
          '  "contact/send-message AC-2",',
          "  async () => {},",
          ");",
        ].join("\n"),
      ).codes,
    ).toEqual([]);
  });

  it("reports a wrong form (GR4013)", () => {
    expect(scan("// @shows contact AC-1\nawait shows(context, 'x', () => {});").codes).toEqual([
      "GR4013:1",
    ]);
    expect(scan('const a = 1; // @shows contact/send-message AC-1').codes).toEqual(["GR4013:1"]);
  });

  it("reports a line with no shows() call under it (GR4013)", () => {
    expect(scan("// @shows contact/send-message AC-1\nconst a = 1;")).toEqual({
      shows: ["contact/send-message AC-1 call:none"],
      codes: ["GR4013:1"],
    });
  });

  it("reports a call that names another criterion (GR4013)", () => {
    expect(
      scan(
        '// @shows contact/send-message AC-1\nawait shows(context, "contact/send-message AC-2", () => {});',
      ).codes,
    ).toEqual(["GR4013:1"]);
  });

  it("ignores a line inside a block comment", () => {
    expect(
      scan("/*\n// @shows contact/send-message AC-1\n*/\nconst a = 1;"),
    ).toEqual({ shows: [], codes: [] });
  });

  it("reports a flow or criterion that does not exist (GR4014)", () => {
    expect(
      scan('// @shows contact/send-message AC-9\nawait shows(context, "contact/send-message AC-9", () => {});')
        .codes,
    ).toEqual(["GR4014:1"]);
    expect(
      scan('// @shows contact/other AC-1\nawait shows(context, "contact/other AC-1", () => {});').codes,
    ).toEqual(["GR4014:1"]);
  });
});
