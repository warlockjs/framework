import { describe, expect, it } from "vitest";
import {
  describeUnitGuardViolations,
  findUnitGuardViolations,
  guardUnitProject,
} from "./guard-unit-project";

describe("findUnitGuardViolations", () => {
  it("accepts a plain unit spec", () => {
    const source = `
      import { describe, expect, it } from "vitest";
      import { slugify } from "./slugify";
      import type { HttpConnector } from "@warlock.js/core";
    `;

    expect(findUnitGuardViolations(source)).toEqual([]);
  });

  it.each([
    ['import { connectorsManager } from "@warlock.js/core";', "connectorsManager"],
    ['import { HttpConnector } from "@warlock.js/core";', "HttpConnector"],
    ['import { bootstrap } from "@warlock.js/core";', "bootstrap"],
    ['import { startHttpTestServer } from "@warlock.js/core/tests";', "startHttpTestServer"],
    [
      'import { createTestHttpServer as serve } from "@warlock.js/core/tests";',
      "createTestHttpServer",
    ],
    ['import { boot } from "../../bootstrap";', "../../bootstrap"],
  ])("names the offending import in %s", (line, name) => {
    const violations = findUnitGuardViolations(line);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.what).toContain(name);
  });

  it("flags setupTest() outside unit mode, wherever mode sits in the options", () => {
    expect(findUnitGuardViolations("await setupTest();")).toHaveLength(1);
    expect(
      findUnitGuardViolations("await setupTest({ importModule: (file) => import(file) });"),
    ).toHaveLength(1);
  });

  it("accepts setupTest() in unit mode with nested parentheses before the mode", () => {
    const source = `await setupTest({ importModule: (file) => import(file), mode: "unit" });`;

    expect(findUnitGuardViolations(source)).toEqual([]);
  });

  it("ignores imports and calls that only appear in comments", () => {
    const source = `
      // import { connectorsManager } from "@warlock.js/core";
      /* await setupTest(); */
    `;

    expect(findUnitGuardViolations(source)).toEqual([]);
  });

  it("honours the allow list", () => {
    const source = 'import { connectorsManager } from "@warlock.js/core";';

    expect(findUnitGuardViolations(source, { allow: ["connectorsManager"] })).toEqual([]);
  });
});

describe("describeUnitGuardViolations", () => {
  it("names the file, the import and where to move the spec", () => {
    const message = describeUnitGuardViolations("/app/src/a.spec.ts", [
      { what: 'connectorsManager from "@warlock.js/core"', reason: "it starts connectors" },
    ]);

    expect(message).toContain("/app/src/a.spec.ts");
    expect(message).toContain('connectorsManager from "@warlock.js/core"');
    expect(message).toContain("integration project");
  });

  it("returns undefined for a clean spec", () => {
    expect(describeUnitGuardViolations("a.spec.ts", [])).toBeUndefined();
  });
});

describe("guardUnitProject", () => {
  const plugin = guardUnitProject();

  it("throws for a spec that imports a connector", () => {
    expect(() =>
      plugin.transform(
        'import { connectorsManager } from "@warlock.js/core";',
        "/app/a.unit.spec.ts",
      ),
    ).toThrow(/connectorsManager/);
  });

  it("leaves non-spec files and dependencies alone", () => {
    const code = 'import { connectorsManager } from "@warlock.js/core";';

    expect(plugin.transform(code, "/app/src/service.ts")).toBeNull();
    expect(plugin.transform(code, "/app/node_modules/x/a.unit.spec.ts")).toBeNull();
  });

  it("checks .unit.test files and leaves plain specs to the integration project", () => {
    const code = 'import { connectorsManager } from "@warlock.js/core";';

    expect(() => plugin.transform(code, "/app/src/a.unit.test.ts")).toThrow(/connectorsManager/);
    expect(plugin.transform(code, "/app/src/a.spec.ts")).toBeNull();
    expect(plugin.transform(code, "/app/src/a.test.ts")).toBeNull();
  });

  it("passes a clean spec through", () => {
    expect(plugin.transform('import { it } from "vitest";', "/app/a.unit.spec.ts?v=1")).toBeNull();
  });
});
