import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNonInteractiveOptions } from "../src/commands/create-new-app";
import type { Application, LintToolchain } from "../src/commands/create-new-app/types";
import { buildHelpText } from "../src/flags/definitions";
import { seedFromFlags } from "../src/flags/seed-from-flags";
import { App } from "../src/helpers/app";
import { setPackageManager } from "../src/helpers/package-manager";
import { parseFlags } from "../src/index";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oxlint = path.join(packageRoot, "node_modules/oxlint/bin/oxlint");
const oxfmt = path.join(packageRoot, "node_modules/oxfmt/bin/oxfmt");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scaffold(lint?: LintToolchain, web = false) {
  setPackageManager("yarn");
  const root = mkdtempSync(path.join(tmpdir(), "warlock-lint-scaffold-"));
  roots.push(root);
  const appPath = path.join(root, "app");
  const application: Application = {
    appName: "lint-proof",
    appType: "warlock",
    appPath,
    pkgManager: "yarn",
    options: {
      databaseDriver: "none",
      databasePort: 27017,
      features: web ? ["web"] : [],
      aiProviders: [],
      agents: ["claude"],
      useGit: false,
      useJWT: false,
      lint,
    },
  };
  const app = new App(application)
    .use("warlock")
    .updatePackageJson()
    .configureWebStarter(web)
    .configureLintToolchain();
  return { appPath, app };
}

function run(tool: string, appPath: string, args: string[]) {
  const result = spawnSync(process.execPath, [tool, ...args], {
    cwd: appPath,
    encoding: "utf8",
  });
  return {
    pid: result.pid,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function assertPass(result: ReturnType<typeof run>) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

describe("lint toolchain flags", () => {
  it("defaults to Oxc and documents its single supported value", () => {
    expect(resolveNonInteractiveOptions({}).lint).toBe("oxc");
    expect(resolveNonInteractiveOptions({ lint: "oxc" }).lint).toBe("oxc");
    expect(seedFromFlags({}).lint).toBe("oxc");
    expect(buildHelpText()).toContain("--lint=<oxc>");
  });
  it("rejects ESLint with removal and default guidance", () => {
    expect(() => resolveNonInteractiveOptions(parseFlags(["app", "--lint", "eslint"]))).toThrow(
      /removed in 5\.34\.0.*Oxlint\/Oxfmt.*default/,
    );
  });
  it.each(["", "other"])("rejects invalid toolchain %j", (lint) => {
    expect(() => resolveNonInteractiveOptions({ lint })).toThrow(/Use --lint=oxc/);
  });
  it("rejects a valueless flag", () => {
    expect(() => resolveNonInteractiveOptions(parseFlags(["app", "--lint"]))).toThrow(
      /Unknown lint toolchain/,
    );
  });
});

describe("generated toolchains", () => {
  it.each(["oxc"] as const)("uses supported tsconfig options for %s", (lint) => {
    const { appPath } = scaffold(lint);
    const config = readFileSync(path.join(appPath, "tsconfig.json"), "utf8");
    expect(config).not.toContain('"baseUrl"');
    expect(config).toContain('"module": "ESNext"');
    expect(config).toContain('"moduleResolution": "bundler"');
    expect(config).toContain('"types": ["node"]');
    expect(config).toContain('"app/*": ["./src/app/*"]');
  });

  it.each([false, true])(
    "defaults to pinned Oxc and TypeScript 7 and wires its checker for web=%s",
    (web) => {
      const { appPath, app } = scaffold(undefined, web);
      app.configureLintToolchain();
      const pkg = JSON.parse(readFileSync(path.join(appPath, "package.json"), "utf8"));
      expect(pkg.devDependencies.typescript).toBe("7.0.2");
      expect(pkg.devDependencies.oxlint).toBe("1.88.0");
      expect(pkg.devDependencies.oxfmt).toBe("0.73.0");
      if (web) {
        expect(pkg.dependencies["@mongez/react-form"]).toBeTruthy();
        expect(pkg.devDependencies.tailwindcss).toBeTruthy();
      }
      expect(
        Object.keys(pkg.devDependencies).filter((name) => /eslint|prettier/.test(name)),
      ).toEqual([]);
      expect(pkg.scripts.format).toContain("--ignore-path .oxfmtignore");
      expect(existsSync(path.join(appPath, ".oxfmtignore"))).toBe(true);
      for (const name of [".oxlintrc.json", ".oxfmtrc.json"])
        expect(existsSync(path.join(appPath, name))).toBe(true);
      const format = JSON.parse(readFileSync(path.join(appPath, ".oxfmtrc.json"), "utf8"));
      expect(format.sortImports).toEqual({
        newlinesBetween: false,
        internalPattern: ["app/", "web/", "@shared/"],
      });
      for (const script of ["lint", "lint:check", "format", "format:check"])
        expect(pkg.scripts[script]).toMatch(/^ox(lint|fmt) /);
      for (const name of ["eslint.config.js", ".prettierrc.json", ".prettierignore"])
        expect(existsSync(path.join(appPath, name))).toBe(false);
      const config = readFileSync(path.join(appPath, "warlock.config.ts"), "utf8");
      expect(config.match(/healthCheckers:/g)).toHaveLength(1);
      expect(config).toContain("healthCheckers: { oxlint: true }");
      const settings = JSON.parse(
        readFileSync(path.join(appPath, ".vscode/settings.json"), "utf8"),
      );
      expect(settings["editor.defaultFormatter"]).toBe("oxc.oxc-vscode");
      expect(settings["editor.formatOnSave"]).toBe(true);
      expect(settings["editor.codeActionsOnSave"]).toEqual({
        "source.fixAll.oxc": "explicit",
        "source.organizeImports": "never",
      });
      for (const language of [
        "typescript",
        "typescriptreact",
        "javascript",
        "javascriptreact",
        "json",
        "css",
      ]) {
        expect(settings[`[${language}]`]["editor.defaultFormatter"]).toBe("oxc.oxc-vscode");
      }
      expect(settings["oxc.enable.oxlint"]).toBe(true);
      expect(settings["oxc.enable.oxfmt"]).toBe(true);
      expect(settings["oxc.requireConfig"]).toBe(true);
      expect(
        Object.keys(settings).some(
          (key) => key.startsWith("prettier.") || key.startsWith("eslint."),
        ),
      ).toBe(false);
      const extensions = JSON.parse(
        readFileSync(path.join(appPath, ".vscode/extensions.json"), "utf8"),
      );
      expect(extensions.recommendations).toContain("oxc.oxc-vscode");
      expect(Object.keys(pkg.devDependencies)).toEqual(
        Object.keys(pkg.devDependencies).sort((left, right) => left.localeCompare(right)),
      );
      expect(existsSync(path.join(appPath, "src/web"))).toBe(web);
    },
  );

  // Both standalone and workspace installs declare the pinned tools locally.
  it.each([false, true])("emits Oxc-clean source for web=%s with the pinned tools", (web) => {
    const { appPath } = scaffold("oxc", web);
    assertPass(run(oxlint, appPath, ["--config", ".oxlintrc.json", "./src", "--max-warnings=0"]));
    assertPass(
      run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--check", "./src", "warlock.config.ts"]),
    );
  });

  it("honors the emitted Oxfmt ignore file", () => {
    const { appPath } = scaffold("oxc");
    writeFileSync(
      path.join(appPath, "src/ignored.ts"),
      "export const ignored={value:'unformatted'}\n",
    );
    writeFileSync(path.join(appPath, ".oxfmtignore"), "src/ignored.ts\n");
    const args = [
      "--ignore-path",
      ".gitignore",
      "--ignore-path",
      ".oxfmtignore",
      "--check",
      "./src",
    ];
    assertPass(run(oxfmt, appPath, args));
    writeFileSync(path.join(appPath, ".oxfmtignore"), "");
    expect(run(oxfmt, appPath, args).status).toBe(1);
  });

  it("detects lint and format regressions and fixes formatting", () => {
    const { appPath } = scaffold("oxc");
    const fixture = path.join(appPath, "src", "lint-proof.ts");
    writeFileSync(
      fixture,
      "import { readFile } from 'node:fs';\nexport class Example { value=1 }\n",
    );
    const lint = run(oxlint, appPath, [
      "--config",
      ".oxlintrc.json",
      "--format",
      "json",
      fixture,
      "--max-warnings=0",
    ]);
    expect(lint.status).toBe(1);
    expect(lint.stdout).toContain("no-unused-vars");
    expect(lint.stdout).toContain("explicit-member-accessibility");
    expect(run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--check", fixture]).status).toBe(1);
    assertPass(run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--write", fixture]));
    assertPass(run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--check", fixture]));
    expect(readFileSync(fixture, "utf8")).toContain('from "node:fs";');
  });

  it("sorts imports into one block on format", () => {
    const { appPath } = scaffold("oxc");
    const fixture = path.join(appPath, "src", "sort-proof.ts");
    writeFileSync(
      fixture,
      [
        'import { z } from "zod";',
        'import { local } from "./local";',
        'import { readFile } from "node:fs";',
        'import { config } from "app/config";',
        "export const values = [z, local, readFile, config];",
        "",
      ].join("\n"),
    );
    expect(run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--check", fixture]).status).toBe(1);
    assertPass(run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--write", fixture]));
    expect(readFileSync(fixture, "utf8")).toBe(
      [
        'import { readFile } from "node:fs";',
        'import { z } from "zod";',
        'import { config } from "app/config";',
        'import { local } from "./local";',
        "export const values = [z, local, readFile, config];",
        "",
      ].join("\n"),
    );
  });
});
