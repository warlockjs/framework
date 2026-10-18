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
import { oxcToolchain, OXC_VERSIONS, OXC_SCRIPTS } from "./codemods/oxc-toolchain";
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

  it("retains customized configs with actionable file:line findings, removing legacy dependencies", async () => {
    const root = materialize("oxc-toolchain-custom");
    const before = snapshot(root).filter(([file]) => file !== "package.json");
    const result = await upgrade(root);
    expect(result.manual.map(({ file, line }) => ({ file, line }))).toEqual(
      JSON.parse(readFileSync(path.join(fixtures, "oxc-toolchain-custom/manual.json"), "utf8")),
    );
    for (const [file, content] of before)
      expect(readFileSync(path.join(root, file ?? ""), "utf8")).toBe(content);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies).toEqual(OXC_VERSIONS);
    expect(pkg.scripts).toEqual(OXC_SCRIPTS);
    expect(
      result.manual.every(({ hint }) => hint.includes("Port") && hint.includes("5.34.0")),
    ).toBe(true);
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
        readFileSync(path.join(create, "templates/warlock", file), "utf8"),
      );
    }
    const helper = readFileSync(path.join(create, "src/helpers/app.ts"), "utf8");
    for (const [name, version] of Object.entries(OXC_VERSIONS))
      expect(helper).toContain(name === "typescript" ? `"${version}"` : `${name}: "${version}"`);
  });
});
