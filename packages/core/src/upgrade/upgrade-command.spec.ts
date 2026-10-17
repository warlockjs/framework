import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unifiedDiff } from "./diff";
import { tsMorphInstallCommand } from "./load-ts-morph";
import { detectInstalledVersion, runUpgrade } from "./run-upgrade";
import { runUpgradeCommand } from "./upgrade-command.action";
import { compareVersions, normalizeVersion } from "./version";

const roots: string[] = [];
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  previousExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SERVICE = `import { log } from "@warlock.js/logger";

export async function run() {
  await log.info("jobs", "run", "Started");
}
`;

const SCHEMA = `import { v } from "@warlock.js/seal";

export const schema = v.object({ name: v.string().refine((value) => value.length > 1) });
`;

function createApp(coreVersion = "^5.29.0"): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-upgrade-command-"));
  roots.push(root);
  mkdirSync(path.join(root, "src/app/jobs"), { recursive: true });
  writeFileSync(path.join(root, "src/app/jobs/run.service.ts"), SERVICE);
  writeFileSync(path.join(root, "src/app/jobs/job.schema.ts"), SCHEMA);
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "app", dependencies: { "@warlock.js/core": coreVersion } }, null, 2)}\n`,
  );
  return root;
}

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    output: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

describe("warlock upgrade", () => {
  it("--dry-run prints a diff and the review list and writes nothing", async () => {
    const root = createApp();
    const { logs, output } = capture();

    const code = await runUpgradeCommand({ to: "5.31", dryRun: true }, { root }, output);

    expect(code).toBe(0);
    expect(readFileSync(path.join(root, "src/app/jobs/run.service.ts"), "utf8")).toBe(SERVICE);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toContain('"^5.29.0"');
    const report = logs.join("\n");
    expect(report).toContain("dry run");
    expect(report).toContain('-  await log.info("jobs", "run", "Started");');
    expect(report).toContain('+  log.info("jobs", "run", "Started");');
    expect(report).toContain("src/app/jobs/job.schema.ts:3");
    expect(report).toContain("upgrade-from-5-29");
  });

  it("applies the edits and bumps the family versions without --dry-run", async () => {
    const root = createApp();
    const result = await runUpgrade({ root, to: "5.31" });

    expect(readFileSync(path.join(root, "src/app/jobs/run.service.ts"), "utf8")).toContain(
      '  log.info("jobs", "run", "Started");',
    );
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies).toEqual({
      "@warlock.js/core": "^5.31.0",
    });
    expect(result.from).toBe("5.29.0");
    expect(result.changedFiles).toEqual(["package.json", "src/app/jobs/run.service.ts"]);
    expect(result.installHint).toBe("npm install");
  });

  it("--json prints the machine-readable result", async () => {
    const root = createApp();
    const { logs, output } = capture();

    await runUpgradeCommand({ to: "5.31.0", json: true, dryRun: true }, { root }, output);

    const parsed = JSON.parse(logs.join("")) as Record<string, unknown>;
    expect(parsed).toMatchObject({ from: "5.29.0", to: "5.31.0", dryRun: true });
    expect(parsed.applied).toContainEqual({
      codemod: "logger-sync-calls",
      file: "src/app/jobs/run.service.ts",
      line: 4,
      description: "removed await before log.info()",
    });
    expect(parsed.manual).toContainEqual(
      expect.objectContaining({
        codemod: "seal-refine-output",
        file: "src/app/jobs/job.schema.ts",
        line: 3,
        skill: "seal-basics",
      }),
    );
    expect(parsed.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: "5.30.0" })]),
    );
    expect(typeof parsed.diff).toBe("string");
  });

  it("only runs the codemods between --from and --to", async () => {
    const root = createApp();
    const result = await runUpgrade({ root, from: "5.30", to: "5.31", dryRun: true });

    const ids = result.codemods.map((codemod) => codemod.id);
    expect(ids).not.toContain("logger-sync-calls");
    expect(ids).toContain("seal-refine-output");
    expect(ids).toContain("warlock-versions");
    expect(result.notes).toEqual([]);
    expect(result.applied.some((item) => item.codemod === "logger-sync-calls")).toBe(false);
  });

  it("refuses a target that is not newer, and a version it cannot parse", async () => {
    const root = createApp("^5.31.0");
    const { errors, output } = capture();

    expect(await runUpgradeCommand({ to: "5.31" }, { root }, output)).toBe(1);
    expect(errors.join("\n")).toContain(
      "The installed @warlock.js/core is already 5.31.0, the --to version",
    );
    expect(errors.join("\n")).toContain("--from <previous version>");
    expect(errors.join("\n")).toContain("warlock upgrade --from 5.30 --to 5.31.0");
    expect(await runUpgradeCommand({ to: "5.30", from: "5.31" }, { root }, output)).toBe(1);
    expect(errors.join("\n")).toContain("--from 5.31.0 is not older than --to 5.30.0");
    expect(await runUpgradeCommand({ to: "next" }, { root }, output)).toBe(1);
    expect(errors.join("\n")).toContain('"next" is not a version');
    expect(await runUpgradeCommand({}, { root }, output)).toBe(1);
    expect(errors.join("\n")).toContain("--to 5.31");
    expect(process.exitCode).toBe(1);
  });

  it("explains how to install ts-morph when it is missing", async () => {
    const root = createApp();
    writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const { errors, output } = capture();

    const code = await runUpgradeCommand(
      { to: "5.31" },
      {
        root,
        loadTsMorph: async () => {
          const { TsMorphMissingError } = await import("./load-ts-morph");
          throw new TsMorphMissingError(tsMorphInstallCommand("pnpm"));
        },
      },
      output,
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("pnpm add --save-dev ts-morph");
    expect(readFileSync(path.join(root, "src/app/jobs/run.service.ts"), "utf8")).toBe(SERVICE);
  });

  it("detects the installed core version before the package.json range", () => {
    const root = createApp("^5.28.0");
    mkdirSync(path.join(root, "node_modules/@warlock.js/core"), { recursive: true });
    writeFileSync(
      path.join(root, "node_modules/@warlock.js/core/package.json"),
      JSON.stringify({ version: "5.29.3" }),
    );
    expect(detectInstalledVersion(root)).toBe("5.29.3");
  });
});

describe("upgrade helpers", () => {
  it("normalizes and compares versions", () => {
    expect(normalizeVersion("5.31")).toBe("5.31.0");
    expect(normalizeVersion("v5.30.2")).toBe("5.30.2");
    expect(() => normalizeVersion("^5.31")).toThrow(/not a version/);
    expect(compareVersions("5.30.0", "5.31.0")).toBeLessThan(0);
    expect(compareVersions("5.31.0", "5.31")).toBe(0);
  });

  it("produces a unified diff with context", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const after = "a\nb\nc\nD\ne\nf\ng\nh\n";
    expect(unifiedDiff("x.ts", before, after)).toBe(
      "--- a/x.ts\n+++ b/x.ts\n@@ -1,7 +1,7 @@\n a\n b\n c\n-d\n+D\n e\n f\n g\n",
    );
    expect(unifiedDiff("x.ts", before, before)).toBe("");
  });

  it("names the dev-dependency install for each package manager", () => {
    expect(tsMorphInstallCommand("npm")).toBe("npm install --save-dev ts-morph");
    expect(tsMorphInstallCommand("yarn")).toBe("yarn add --dev ts-morph");
    expect(tsMorphInstallCommand("bun")).toBe("bun add --dev ts-morph");
  });
});
