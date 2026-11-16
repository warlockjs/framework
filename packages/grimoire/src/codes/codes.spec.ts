import { describe, expect, it } from "vitest";
import {
  createFinding,
  explainGrimoireCode,
  GRIMOIRE_CODE_LIST,
  GRIMOIRE_CODES,
  GrimoireError,
  grimoireCodeDocsUrl,
  isGrimoireCode,
} from "./index";

const AREA_BY_DIGIT: Record<string, string> = {
  "1": "structure",
  "2": "links",
  "3": "files",
  "4": "tests",
  "5": "apps",
  "6": "changelog",
  "7": "tasks",
  "8": "book",
  "9": "usage",
};

const SKILLS = new Set([
  "use-the-grimoire",
  "document-a-file",
  "write-a-feature",
  "record-a-change",
  "describe-an-app",
  "backfill-a-grimoire",
]);

describe("the code catalog", () => {
  it("gives every code the GR format, a unique value and the area of its first digit", () => {
    const seen = new Set<string>();

    for (const definition of GRIMOIRE_CODE_LIST) {
      expect(definition.code).toMatch(/^GR[1-9]\d{3}$/);
      expect(seen.has(definition.code)).toBe(false);
      seen.add(definition.code);
      expect(definition.area).toBe(AREA_BY_DIGIT[definition.code.charAt(2)]);
      expect(SKILLS.has(definition.skill)).toBe(true);
      expect(definition.title.length).toBeGreaterThan(10);
      expect(definition.fix.length).toBeGreaterThan(10);
    }

    expect(Object.keys(GRIMOIRE_CODES)).toHaveLength(GRIMOIRE_CODE_LIST.length);
  });

  it("explains a code whatever its case and spacing", () => {
    expect(explainGrimoireCode(" gr2001 ")?.title).toBe(
      "A route step names a route that does not exist",
    );
    expect(explainGrimoireCode("GR0000")).toBeUndefined();
    expect(explainGrimoireCode("WL3001")).toBeUndefined();
    expect(isGrimoireCode("GR1001")).toBe(true);
    expect(isGrimoireCode("gr1001")).toBe(false);
    expect(grimoireCodeDocsUrl("GR1001")).toMatch(/#gr1001$/);
  });

  it("builds a finding from the catalog", () => {
    const finding = createFinding({
      code: "GR2001",
      message: 'route step "POST /wishlist" matches no route',
      at: { file: "grimoire/features/catalog/flows/wishlist.md", line: 12, column: null },
      feature: "catalog",
      flow: "catalog/wishlist",
    });

    expect(finding).toEqual({
      code: "GR2001",
      severity: "error",
      message: 'route step "POST /wishlist" matches no route',
      at: { file: "grimoire/features/catalog/flows/wishlist.md", line: 12, column: null },
      expected: false,
      subject: {
        feature: "catalog",
        flow: "catalog/wishlist",
        app: null,
        task: null,
        file: "grimoire/features/catalog/flows/wishlist.md",
      },
      hint: "Fix the method and path in the flow, or add the route in code.",
    });
    expect(createFinding({ code: "GR3001", message: "x", severity: "error" }).severity).toBe("error");
    expect(() => createFinding({ code: "GR0001", message: "x" })).toThrow(/Unknown Grimoire code/);
  });

  it("carries a code on GrimoireError", () => {
    const error = new GrimoireError("GR9001", "src/app/x.ts is not in the book");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("GR9001");
    expect(error.name).toBe("GrimoireError");
  });
});
