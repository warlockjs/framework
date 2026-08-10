import { describe, expect, it } from "vitest";
import {
  assertGeneratedImportsAreDeclared,
  extractSpecifiers,
  findUndeclaredImports,
  resolvePackageName,
  UndeclaredGeneratedImportError,
} from "../../../src/production/assert-generated-imports";

describe("extractSpecifiers", () => {
  it("finds every import form the generator emits", () => {
    const content = [
      'import "./bootstrap";',
      'import { setConfig, configSpecialHandlers } from "@warlock.js/core";',
      'import databaseConfig from "../../src/config/database";',
      'await import("./routes");',
      'export * from "@warlock.js/cascade";',
    ].join("\n");

    expect(extractSpecifiers(content)).toEqual([
      "./bootstrap",
      "@warlock.js/core",
      "../../src/config/database",
      "./routes",
      "@warlock.js/cascade",
    ]);
  });

  it("returns nothing for a file with no imports", () => {
    expect(extractSpecifiers("const port = 3000;\n")).toEqual([]);
  });

  it("keeps a side-effect import that is followed by a `from` import", () => {
    // Regression: a lazy match for `from` used to run past the end of its own
    // statement, binding `import "./bootstrap"` to the next line's `from` and
    // dropping it from the results entirely.
    const content = ['import "./bootstrap";', 'import config from "@mongez/config";'].join("\n");

    expect(extractSpecifiers(content)).toEqual(["./bootstrap", "@mongez/config"]);
  });

  it("reads a multi-line import statement", () => {
    const content = 'import {\n  setConfig,\n  configSpecialHandlers,\n} from "@warlock.js/core";';

    expect(extractSpecifiers(content)).toEqual(["@warlock.js/core"]);
  });
});

describe("resolvePackageName", () => {
  it.each([
    ["@mongez/config", "@mongez/config"],
    ["@warlock.js/core", "@warlock.js/core"],
    ["@warlock.js/core/utils", "@warlock.js/core"],
    ["fast-glob", "fast-glob"],
    ["fast-glob/out/index", "fast-glob"],
  ])("resolves %s to %s", (specifier, expected) => {
    expect(resolvePackageName(specifier)).toBe(expected);
  });

  it.each([
    ["a relative path", "./bootstrap"],
    ["a parent path", "../../src/config/database"],
    ["an absolute path", "/var/app/entry"],
    ["a prefixed builtin", "node:path"],
    ["a bare builtin", "fs"],
    ["a url", "file:///D:/app/node_modules/esbuild/lib/main.js"],
  ])("ignores %s", (_label, specifier) => {
    expect(resolvePackageName(specifier)).toBeUndefined();
  });
});

describe("findUndeclaredImports", () => {
  it("passes generated code that imports only what the app declares", () => {
    const violations = findUndeclaredImports(
      [
        {
          file: "config-loader.ts",
          content: [
            'import { setConfig, configSpecialHandlers } from "@warlock.js/core";',
            'import databaseConfig from "../../src/config/database";',
            'import path from "node:path";',
          ].join("\n"),
        },
      ],
      ["@warlock.js/core", "@warlock.js/cascade"],
    );

    expect(violations).toEqual([]);
  });

  it("catches the exact regression that shipped — a bare @mongez/config", () => {
    const violations = findUndeclaredImports(
      [{ file: "config-loader.ts", content: 'import config from "@mongez/config";' }],
      ["@warlock.js/core"],
    );

    expect(violations).toEqual([
      {
        file: "config-loader.ts",
        specifier: "@mongez/config",
        packageName: "@mongez/config",
      },
    ]);
  });

  it("catches a deep import of an undeclared package", () => {
    const violations = findUndeclaredImports(
      [{ file: "app.ts", content: 'import { x } from "@mongez/reinforcements/utils";' }],
      ["@warlock.js/core"],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].packageName).toBe("@mongez/reinforcements");
  });

  it("reports every violation across every file, not just the first", () => {
    const violations = findUndeclaredImports(
      [
        { file: "config-loader.ts", content: 'import config from "@mongez/config";' },
        { file: "locales.ts", content: 'import { t } from "@mongez/localization";' },
      ],
      [],
    );

    expect(violations.map((violation) => violation.packageName)).toEqual([
      "@mongez/config",
      "@mongez/localization",
    ]);
  });
});

describe("assertGeneratedImportsAreDeclared", () => {
  it("does not throw when every import is declared", () => {
    expect(() =>
      assertGeneratedImportsAreDeclared(
        [{ file: "app.ts", content: 'import { bootstrap } from "@warlock.js/core";' }],
        ["@warlock.js/core"],
      ),
    ).not.toThrow();
  });

  it("throws naming the file, the specifier and the missing package", () => {
    let thrown: UndeclaredGeneratedImportError | undefined;

    try {
      assertGeneratedImportsAreDeclared(
        [{ file: "config-loader.ts", content: 'import config from "@mongez/config";' }],
        ["@warlock.js/core"],
      );
    } catch (error) {
      thrown = error as UndeclaredGeneratedImportError;
    }

    expect(thrown).toBeInstanceOf(UndeclaredGeneratedImportError);
    expect(thrown?.violations).toHaveLength(1);
    expect(thrown?.message).toContain("config-loader.ts");
    expect(thrown?.message).toContain("@mongez/config");
  });
});
