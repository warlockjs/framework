import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  oxcToolchain,
  oxcToolchainRemoval,
  OXC_VERSIONS,
  OXC_SCRIPTS,
} from "./codemods/oxc-toolchain";
import { OXLINT_RULE_SCHEMAS } from "./codemods/oxlint-rule-schemas";
import { matchesSchema } from "./codemods/validate-oxlint-rule";
import { TOOLCHAIN_TEMPLATES } from "./codemods/toolchain-templates";
import { runUpgrade } from "./run-upgrade";
import { runUpgradeCommand } from "./upgrade-command.action";

const fixtures = path.resolve(__dirname, "../../tests/fixtures/upgrade");
const roots: string[] = [];
function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
}
function materialize(name: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-oxc-upgrade-"));
  roots.push(root);
  const input = path.join(fixtures, name, "input");
  for (const file of files(input)) {
    const target = path.join(root, file.replace(/\.txt$/, ""));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(input, file), target);
  }
  return root;
}
function snapshot(root: string) {
  return files(root).map((file) => [file, readFileSync(path.join(root, file), "utf8")]);
}
const upgrade = (root: string, dryRun = false) =>
  runUpgrade({ root, from: "5.32", to: "5.33.0", codemods: [oxcToolchain], dryRun });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Oxlint/Oxfmt upgrade", () => {
  it("fully migrates the generated ESLint app, including deletions, editor and health settings", async () => {
    const root = materialize("oxc-toolchain");
    const result = await upgrade(root);
    const expected = path.join(fixtures, "oxc-toolchain", "expected");
    expect(files(root)).toEqual(files(expected).map((file) => file.replace(/\.txt$/, "")));
    for (const file of files(expected))
      expect(readFileSync(path.join(root, file.replace(/\.txt$/, "")), "utf8")).toBe(
        readFileSync(path.join(expected, file), "utf8"),
      );
    expect(result.manual).toEqual([]);
    expect(result.installHint).toMatch(/install/);
    expect(result.diff).toContain("--- a/eslint.config.js");
    expect((await upgrade(root)).changedFiles).toEqual([]);
  });

  it("ports custom native rules and retains only unsupported formatting for review", async () => {
    const root = materialize("oxc-toolchain-custom");
    const result = await upgrade(root);
    expect(result.manual.map(({ file }) => file)).toEqual([".prettierignore", ".prettierrc.yaml"]);
    expect(existsSync(path.join(root, "eslint.config.mjs"))).toBe(false);
    expect(existsSync(path.join(root, ".eslintrc.json"))).toBe(false);
    const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
    expect(config.rules).toMatchObject({ eqeqeq: "error", "no-debugger": "error" });
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies).toEqual(OXC_VERSIONS);
    expect(pkg.scripts).toEqual(OXC_SCRIPTS);
  });

  it("leaves an existing Oxc app untouched", async () => {
    const root = materialize("oxc-toolchain-already");
    const before = snapshot(root);
    const result = await upgrade(root);
    expect(result.changedFiles).toEqual([]);
    expect(result.manual).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it("reports additions and deletions in dry-run JSON without changing any bytes", async () => {
    const root = materialize("oxc-toolchain");
    const before = snapshot(root);
    const logs: string[] = [];
    expect(
      await runUpgradeCommand(
        { from: "5.32", to: "5.33.0", dryRun: true, json: true },
        { root, codemods: [oxcToolchain] },
        {
          log: (message) => logs.push(message),
          error: (message) => {
            throw new Error(message);
          },
        },
      ),
    ).toBe(0);
    const result = JSON.parse(logs.join(""));
    expect(result.dryRun).toBe(true);
    expect(result.changedFiles).toContain("eslint.config.js");
    expect(result.changedFiles).toContain(".oxlintrc.json");
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(path.join(root, ".oxlintrc.json"))).toBe(false);
  });

  it("preserves existing Oxc configs and conflicting ignore rules for review", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(path.join(root, ".oxlintrc.json"), '{"rules":{"no-debugger":"error"}}');
    writeFileSync(path.join(root, ".oxfmtignore"), "custom-generated\n");
    const result = await upgrade(root);
    expect(readFileSync(path.join(root, ".oxlintrc.json"), "utf8")).toBe(
      '{"rules":{"no-debugger":"error"}}',
    );
    expect(readFileSync(path.join(root, ".oxfmtignore"), "utf8")).toBe("custom-generated\n");
    expect(existsSync(path.join(root, ".prettierignore"))).toBe(true);
    expect(result.manual).toMatchObject([{ file: ".prettierignore", line: 1 }]);
    expect(result.manual[0]?.hint).toContain("Merge");
  });

  it("lists computed checker options at their source lines", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(
      path.join(root, "warlock.config.ts"),
      "export default defineConfig({\n  devServer: {\n    healthCheckers: [customChecker],\n  },\n});\n",
    );
    const result = await upgrade(root);
    expect(result.manual).toMatchObject([{ file: "warlock.config.ts", line: 3 }]);
    expect(readFileSync(path.join(root, "warlock.config.ts"), "utf8")).toContain("[customChecker]");
  });

  it("keeps bundled templates and dependency versions aligned with create-warlock", () => {
    const create = path.resolve(__dirname, "../../../create-warlock");
    for (const file of [".oxlintrc.json", ".oxfmtrc.json"])
      expect(TOOLCHAIN_TEMPLATES[file.slice(1)]).toBe(
        readFileSync(path.join(create, "templates/toolchains/oxc", file), "utf8"),
      );
    for (const file of [
      "eslint.config.js",
      ".prettierrc.json",
      ".prettierignore",
      ".vscode/settings.json",
    ]) {
      const name = file.startsWith(".vscode/")
        ? "legacy-vscode-settings.json"
        : `legacy-${file.replace(/^\./, "")}`;
      expect(TOOLCHAIN_TEMPLATES[name]).toBe(
        readFileSync(path.join(fixtures, "oxc-toolchain/input", `${file}.txt`), "utf8"),
      );
    }
    const helper = readFileSync(path.join(create, "src/helpers/app.ts"), "utf8");
    for (const [name, version] of Object.entries(OXC_VERSIONS))
      expect(helper).toContain(name === "typescript" ? `"${version}"` : `${name}: "${version}"`);
  });
});

const customConfig = `import tsPlugin from "@typescript-eslint/eslint-plugin";
const boundaries = [{ group: ["app/*/controllers/**", "app/*/repositories/**"], message: "Use public services" }];
export default [
  { ignores: ["dist/", "generated/**"] },
  { files: ["src/**/*.ts"], plugins: { "@typescript-eslint": tsPlugin }, rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "no-restricted-exports": ["error", { restrictedNamedExports: ["default", "internal"] }]
  } },
  { files: ["src/app/billing/**/*.ts"], ignores: ["**/*.spec.ts"], rules: {
    "no-restricted-imports": ["error", { paths: [{ name: "node:fs", importNames: ["readFileSync"] }], patterns: boundaries }],
    "no-restricted-syntax": ["error", { selector: "CallExpression[callee.name='eval']", message: "Avoid evaluation" }]
  } }
];
`;

describe("5.34 removal and custom lint rules", () => {
  it.each([false, true])(
    "ports supported scoped rules and reports only selectors (dryRun=%s)",
    async (dryRun) => {
      const root = materialize("oxc-toolchain");
      writeFileSync(path.join(root, "eslint.config.js"), customConfig);
      writeFileSync(path.join(root, "package-lock.json"), "{}");
      writeFileSync(path.join(root, "pnpm-workspace.yaml"), "allowBuilds: {}\n");
      const before = snapshot(root);
      const result = await runUpgrade({ root, from: "5.33", to: "5.34.0", dryRun });
      expect(result.codemods.map(({ id }) => id)).toContain("oxc-toolchain-removal");
      expect(result.notes.some(({ text }) => /ESLint.*gone.*5\.34\.0/.test(text))).toBe(true);
      expect(result.installHint).toBe("npm install");
      expect(result.manual).toHaveLength(1);
      expect(result.manual[0]).toMatchObject({
        file: "eslint.config.js",
        line: 14,
        codemod: "oxc-toolchain-removal",
      });
      expect(result.manual[0]?.hint).toContain("no-restricted-syntax");
      expect(result.manual[0]?.hint).toContain("src/app/billing/**/*.ts");
      if (dryRun) {
        expect(snapshot(root)).toEqual(before);
        expect(result.diff).toContain('"no-restricted-imports"');
      } else {
        const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
        expect(config.categories.correctness).toBe("error");
        expect(config.ignorePatterns).toContain("generated/**");
        expect(config.overrides[0]).toMatchObject({
          files: ["src/**/*.ts"],
          rules: {
            "typescript/no-explicit-any": "error",
            "typescript/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "no-unused-vars": ["error", { fix: { imports: "safe-fix", variables: "off" } }],
            "no-restricted-exports": ["error", { restrictedNamedExports: ["default", "internal"] }],
          },
        });
        expect(config.overrides[1]).toMatchObject({
          files: ["src/app/billing/**/*.ts"],
          excludeFiles: ["**/*.spec.ts"],
          rules: {
            "no-restricted-imports": [
              "error",
              {
                paths: [{ name: "node:fs", importNames: ["readFileSync"] }],
                patterns: [
                  {
                    group: ["app/*/controllers/**", "app/*/repositories/**"],
                    message: "Use public services",
                  },
                ],
              },
            ],
          },
        });
        expect((await runUpgrade({ root, from: "5.33", to: "5.34.0" })).changedFiles).toEqual([]);
      }
    },
  );

  it("removes a fully ported custom config and its plugin dependencies", async () => {
    const root = materialize("oxc-toolchain-custom");
    await runUpgrade({ root, from: "5.33", to: "5.34.0", codemods: [oxcToolchainRemoval] });
    expect(existsSync(path.join(root, "eslint.config.mjs"))).toBe(false);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(Object.keys(pkg.devDependencies).some((name) => /eslint|prettier/.test(name))).toBe(
      false,
    );
  });

  it("reports unsupported options and imported/computed rules without executing config", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(
      path.join(root, "eslint.config.js"),
      `throw new Error("must never execute");
export default [{ files: ["src/app/**/*.ts"], rules: {
  "no-restricted-imports": ["error", { unknownOption: true }],
  "@typescript-eslint/no-explicit-any": ["error", { unknownOption: true }],
  "custom/private-rule": "error",
  "no-console": chooseSeverity()
} }];`,
    );
    const result = await upgrade(root);
    expect(result.manual).toHaveLength(4);
    for (const name of [
      "no-restricted-imports",
      "@typescript-eslint/no-explicit-any",
      "custom/private-rule",
      "no-console",
    ])
      expect(
        result.manual.some(({ hint }) => hint.includes(name) && hint.includes("src/app/**/*.ts")),
      ).toBe(true);
    expect(existsSync(path.join(root, "eslint.config.js"))).toBe(true);
  });

  it("enables type-aware native equivalents and declares the required optional engine", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(
      path.join(root, "eslint.config.js"),
      'export default [{ rules: { "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }] } }];\n',
    );
    const result = await upgrade(root);
    expect(result.manual).toEqual([]);
    const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
    expect(config.options.typeAware).toBe(true);
    expect(config.rules["typescript/no-floating-promises"]).toEqual([
      "error",
      { ignoreVoid: true },
    ]);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies["oxlint-tsgolint"]).toBe("7.0.2004");
  });

  it("removes stale health switches even when an app already has only Oxc dependencies", async () => {
    const root = materialize("oxc-toolchain-already");
    writeFileSync(
      path.join(root, "warlock.config.ts"),
      "export default defineConfig({ devServer: { healthCheckers: { eslint: false, oxlint: true } } });\n",
    );
    const result = await runUpgrade({ root, from: "5.33", to: "5.34.0" });
    expect(result.changedFiles).toContain("warlock.config.ts");
    expect(readFileSync(path.join(root, "warlock.config.ts"), "utf8")).not.toContain("eslint");
  });
});

describe("pinned Oxlint rule compatibility", () => {
  it("uses the installed rule option assertions", () => {
    const oxlintRoot = path.dirname(createRequire(import.meta.url).resolve("oxlint/package.json"));
    const schema = JSON.parse(
      readFileSync(path.join(oxlintRoot, "configuration_schema.json"), "utf8"),
    );
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (typeof value === "object" && value !== null)
        return Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                ![
                  "description",
                  "markdownDescription",
                  "default",
                  "examples",
                  "title",
                  "deprecated",
                ].includes(key),
            )
            .map(([key, entry]) => [key, strip(entry)]),
        );
      return value;
    };
    for (const [name, assertion] of Object.entries(OXLINT_RULE_SCHEMAS.rules))
      expect(assertion, name).toEqual(strip(schema.definitions.DummyRuleMap.properties[name]));
    for (const [name, assertion] of Object.entries(OXLINT_RULE_SCHEMAS.definitions))
      expect(assertion, name).toEqual(strip(schema.definitions[name]));
    const restriction = OXLINT_RULE_SCHEMAS.rules["no-restricted-imports"];
    if (restriction === undefined) throw new Error("Missing pinned restriction schema");
    expect(
      matchesSchema(
        ["error", { unknownOption: true }],
        restriction,
        OXLINT_RULE_SCHEMAS.definitions,
      ),
    ).toBe(false);
  });

  it("enforces ported folder restrictions with the real Oxlint CLI", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(path.join(root, "eslint.config.js"), customConfig);
    await runUpgrade({ root, from: "5.33", to: "5.34.0" });
    const source = 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n';
    for (const folder of ["billing", "catalog"]) {
      mkdirSync(path.join(root, "src/app", folder), { recursive: true });
      writeFileSync(path.join(root, "src/app", folder, "reader.ts"), source);
    }
    const oxlintRoot = path.dirname(createRequire(import.meta.url).resolve("oxlint/package.json"));
    const result = spawnSync(
      process.execPath,
      [
        path.join(oxlintRoot, "bin/oxlint"),
        "--threads",
        "1",
        "--config",
        ".oxlintrc.json",
        "--format",
        "json",
        "src/app/billing/reader.ts",
        "src/app/catalog/reader.ts",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.pid).toBeGreaterThan(0);
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as {
      diagnostics: { filename: string; code: string }[];
    };
    expect(
      report.diagnostics.some(
        ({ filename, code }) =>
          filename.endsWith("billing/reader.ts") && code.includes("no-restricted-imports"),
      ),
    ).toBe(true);
    expect(report.diagnostics.some(({ filename }) => filename.endsWith("catalog/reader.ts"))).toBe(
      false,
    );
  });
});

describe("literal config variants", () => {
  it("ports inline legacy rules, environments, globals and ignore files", async () => {
    const root = materialize("oxc-toolchain-already");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    pkg.eslintConfig = {
      env: { node: true },
      globals: { appClock: false },
      rules: { "no-restricted-exports": ["error", { restrictedNamedExports: ["internal"] }] },
    };
    writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    writeFileSync(path.join(root, ".eslintignore"), "# generated files\ngenerated/**\n");
    const result = await runUpgrade({ root, from: "5.33", to: "5.34.0" });
    expect(result.manual).toEqual([]);
    const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
    expect(config.env.node).toBe(true);
    expect(config.globals.appClock).toBe("readonly");
    expect(config.ignorePatterns).toContain("generated/**");
    expect(config.rules["no-restricted-exports"]).toEqual([
      "error",
      { restrictedNamedExports: ["internal"] },
    ]);
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))).not.toHaveProperty(
      "eslintConfig",
    );
    expect(existsSync(path.join(root, ".eslintignore"))).toBe(false);
  });

  it("resolves local shorthand and spreads without losing the independent import check", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(
      path.join(root, "eslint.config.js"),
      `const imported = { "unused-imports/no-unused-imports": "error" };
const rules = { ...imported, "@typescript-eslint/no-unused-vars": "off", "no-restricted-syntax": "off" };
export default [{ rules }];`,
    );
    const result = await upgrade(root);
    expect(result.manual).toEqual([]);
    const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
    expect(config.rules["no-unused-vars"]).toEqual([
      "error",
      { fix: { imports: "safe-fix", variables: "off" } },
    ]);
    expect(existsSync(path.join(root, "eslint.config.js"))).toBe(false);
  });

  it("keeps conflicting existing native rules and reports the source rule", async () => {
    const root = materialize("oxc-toolchain");
    writeFileSync(path.join(root, ".oxlintrc.json"), '{"rules":{"no-restricted-exports":"off"}}');
    writeFileSync(
      path.join(root, "eslint.config.js"),
      'export default [{ rules: { "no-restricted-exports": ["error", { restrictedNamedExports: ["internal"] }] } }];',
    );
    const result = await upgrade(root);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.hint).toContain("no-restricted-exports");
    expect(result.manual[0]?.hint).toContain("conflicts");
    expect(readFileSync(path.join(root, ".oxlintrc.json"), "utf8")).toBe(
      '{"rules":{"no-restricted-exports":"off"}}',
    );
  });
});

describe("config combiners and extension rules", () => {
  it.each([
    ['import { defineConfig } from "eslint/config";', "defineConfig"],
    ['import tseslint from "typescript-eslint";', "tseslint.config"],
  ])("ports literal arguments to %s without loading it", async (declaration, combiner) => {
    const root = materialize("oxc-toolchain");
    writeFileSync(
      path.join(root, "eslint.config.js"),
      `${declaration}\nexport default ${combiner}([{ files: ["src/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "error" } }]);\n`,
    );
    expect((await upgrade(root)).manual).toEqual([]);
    const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
    expect(config.overrides[0].rules["typescript/no-explicit-any"]).toBe("error");
  });

  it.each([true, false])(
    "preserves an active TypeScript extension when its base is off (extensionFirst=%s)",
    async (extensionFirst) => {
      const root = materialize("oxc-toolchain");
      const extension = '"@typescript-eslint/no-unused-vars": ["error", { args: "none" }]';
      const base = '"no-unused-vars": "off"';
      writeFileSync(
        path.join(root, "eslint.config.js"),
        `export default [{ rules: { ${extensionFirst ? `${extension}, ${base}` : `${base}, ${extension}`} } }];\n`,
      );
      expect((await upgrade(root)).manual).toEqual([]);
      const config = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
      expect(config.rules["no-unused-vars"]).toEqual(["error", { args: "none" }]);
    },
  );
});
