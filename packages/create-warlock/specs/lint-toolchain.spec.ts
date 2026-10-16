import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveNonInteractiveOptions } from "../src/commands/create-new-app";
import type {
  Application,
  LintToolchain,
} from "../src/commands/create-new-app/types";
import { buildHelpText } from "../src/flags/definitions";
import { seedFromFlags } from "../src/flags/seed-from-flags";
import { App } from "../src/helpers/app";
import { setPackageManager } from "../src/helpers/package-manager";
import { parseFlags } from "../src/index";
import { askLintToolchain } from "../src/prompts/ask-lint-toolchain";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@clack/prompts", async importOriginal => ({
  ...(await importOriginal<object>()),
  select,
}));

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "../..");
const oxlint = path.join(repoRoot, "node_modules/oxlint/bin/oxlint");
const oxfmt = path.join(repoRoot, "node_modules/oxfmt/bin/oxfmt");
const hasOxc = existsSync(oxlint) && existsSync(oxfmt);
const roots: string[] = [];

beforeEach(() => {
  select.mockReset();
});
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function scaffold(lint?: LintToolchain, web = false) {
  setPackageManager("yarn");
  const root = mkdtempSync(path.join(packageRoot, ".lint-scaffold-"));
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
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function assertPass(result: ReturnType<typeof run>) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

describe("lint toolchain flags and prompt", () => {
  it("parses both flag forms and defaults to eslint", () => {
    expect(parseFlags(["app", "--lint=oxc"]).lint).toBe("oxc");
    expect(parseFlags(["app", "--lint", "eslint"]).lint).toBe("eslint");
    expect(resolveNonInteractiveOptions({}).lint).toBe("eslint");
    expect(resolveNonInteractiveOptions({ lint: "oxc" }).lint).toBe("oxc");
    expect(seedFromFlags({ lint: "oxc" }).lint).toBe("oxc");
    expect(buildHelpText()).toContain("--lint=<oxc|eslint>");
  });

  it.each(["", "other"])(
    "rejects an invalid toolchain %j before writing files",
    lint => {
      expect(() => resolveNonInteractiveOptions({ lint })).toThrow(
        /--lint=eslint or --lint=oxc/,
      );
    },
  );

  it("rejects a valueless --lint rather than accepting the default", () => {
    expect(() =>
      resolveNonInteractiveOptions(parseFlags(["app", "--lint"])),
    ).toThrow(/Unknown lint toolchain/);
  });

  it("offers both toolchains and preselects the provided answer", async () => {
    select.mockResolvedValueOnce("oxc");
    expect(await askLintToolchain("oxc")).toBe("oxc");
    expect(select.mock.calls[0][0]).toMatchObject({
      initialValue: "oxc",
      options: [
        { value: "eslint", label: "ESLint + Prettier" },
        { value: "oxc", label: "Oxlint + Oxfmt" },
      ],
    });
  });
});

describe("generated toolchains", () => {
  it("retains ESLint/Prettier as the default and provides non-mutating scripts", () => {
    const { appPath } = scaffold();
    const pkg = JSON.parse(
      readFileSync(path.join(appPath, "package.json"), "utf8"),
    );
    expect(pkg.devDependencies.eslint).toBeTruthy();
    expect(pkg.devDependencies.prettier).toBeTruthy();
    expect(pkg.devDependencies.oxlint).toBeUndefined();
    expect(pkg.scripts["lint:check"]).toContain("eslint ./src");
    expect(pkg.scripts["format:check"]).toContain("prettier --check");
    expect(existsSync(path.join(appPath, "eslint.config.js"))).toBe(true);
    expect(existsSync(path.join(appPath, ".oxlintrc.json"))).toBe(false);
  });

  it.each([false, true])(
    "emits ESLint/Prettier-clean source for web=%s",
    web => {
      const { appPath } = scaffold(undefined, web);
      assertPass(
        run(
          path.join(packageRoot, "node_modules/eslint/bin/eslint.js"),
          appPath,
          ["./src", "--max-warnings=0"],
        ),
      );
      assertPass(
        run(
          path.join(packageRoot, "node_modules/prettier/bin/prettier.cjs"),
          appPath,
          [
            "--config",
            ".prettierrc.json",
            "--check",
            "./src/**/*.{js,jsx,ts,tsx,css,md,json}",
          ],
        ),
      );
    },
  );

  it.each([false, true])("pins Oxc and wires its checker for web=%s", web => {
    const { appPath, app } = scaffold("oxc", web);
    app.configureLintToolchain();
    const pkg = JSON.parse(
      readFileSync(path.join(appPath, "package.json"), "utf8"),
    );
    expect(pkg.devDependencies.oxlint).toBe("1.88.0");
    expect(pkg.devDependencies.oxfmt).toBe("0.73.0");
    if (web) {
      expect(pkg.dependencies["@mongez/react-form"]).toBeTruthy();
      expect(pkg.devDependencies.tailwindcss).toBeTruthy();
    }
    expect(
      Object.keys(pkg.devDependencies).filter(name =>
        /eslint|prettier/.test(name),
      ),
    ).toEqual([]);
    for (const name of [".oxlintrc.json", ".oxfmtrc.json"])
      expect(existsSync(path.join(appPath, name))).toBe(true);
    for (const name of [
      "eslint.config.js",
      ".prettierrc.json",
      ".prettierignore",
    ])
      expect(existsSync(path.join(appPath, name))).toBe(false);
    const config = readFileSync(
      path.join(appPath, "warlock.config.ts"),
      "utf8",
    );
    expect(config.match(/healthCheckers:/g)).toHaveLength(1);
    expect(config).toContain("healthCheckers: { eslint: false, oxlint: true }");
    expect(existsSync(path.join(appPath, "src/web"))).toBe(web);
  });

  // Standalone scaffolder checkouts do not install the monorepo's root tools.
  it.skipIf(!hasOxc).each([false, true])(
    "emits Oxc-clean source for web=%s with the pinned tools",
    web => {
      const { appPath } = scaffold("oxc", web);
      assertPass(
        run(oxlint, appPath, [
          "--config",
          ".oxlintrc.json",
          "./src",
          "--max-warnings=0",
        ]),
      );
      assertPass(
        run(oxfmt, appPath, [
          "--config",
          ".oxfmtrc.json",
          "--check",
          "./src",
          "warlock.config.ts",
        ]),
      );
    },
  );

  it.skipIf(!hasOxc)(
    "detects lint and format regressions and fixes formatting",
    () => {
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
      expect(
        run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--check", fixture])
          .status,
      ).toBe(1);
      assertPass(
        run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--write", fixture]),
      );
      assertPass(
        run(oxfmt, appPath, ["--config", ".oxfmtrc.json", "--check", fixture]),
      );
      expect(readFileSync(fixture, "utf8")).toContain('from "node:fs";');
    },
  );
});
