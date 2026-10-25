import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CheckCommand,
  type CheckCommandOutcome,
  isExcludedFromScratch,
  runUpgradeCheck,
} from "./check-upgrade";
import { formatUpgradeCheckReport } from "./format-upgrade-check-report";
import { runUpgradeCommand } from "./upgrade-command.action";

const roots: string[] = [];
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  previousExitCode = process.exitCode;
  vi.stubEnv("npm_config_user_agent", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = previousExitCode;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SERVICE = `import { log } from "@warlock.js/logger";

export async function run() {
  await log.info("jobs", "run", "Started");
}
`;

function createApp(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-upgrade-check-app-"));
  roots.push(root);
  mkdirSync(path.join(root, "src/app/jobs"), { recursive: true });
  mkdirSync(path.join(root, "node_modules/left-pad"), { recursive: true });
  mkdirSync(path.join(root, "storage/uploads"), { recursive: true });
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, "node_modules/left-pad/index.js"), "");
  writeFileSync(path.join(root, "storage/uploads/a.png"), "");
  writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main");
  writeFileSync(path.join(root, "src/app/jobs/run.service.ts"), SERVICE);
  writeFileSync(path.join(root, "package-lock.json"), "{}");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "app", dependencies: { "@warlock.js/core": "^5.29.0" } }, null, 2)}\n`,
  );
  return root;
}

type Recorded = { command: CheckCommand; scratchFiles: string[] };

/** A fake process runner: records each command and the copy's top-level contents. */
function fakeRunner(
  outcome: (command: CheckCommand) => Partial<CheckCommandOutcome> = () => ({}),
) {
  const recorded: Recorded[] = [];

  return {
    recorded,
    run: async (command: CheckCommand): Promise<CheckCommandOutcome> => {
      recorded.push({ command, scratchFiles: readdirSync(command.cwd).sort() });

      return { exitCode: 0, output: "", timedOut: false, ...outcome(command) };
    },
  };
}

describe("isExcludedFromScratch", () => {
  it.each([
    ["node_modules", true],
    ["packages/web/node_modules/x", true],
    [".git", true],
    ["storage", true],
    ["storage/uploads/a.png", true],
    ["src/storage/index.ts", false],
    ["src/app/jobs", false],
    ["", false],
  ])("%s -> %s", (relative, expected) => {
    expect(isExcludedFromScratch(relative)).toBe(expected);
  });
});

describe("warlock upgrade --check", () => {
  it("rehearses the upgrade on a copy and never writes the real project", async () => {
    const root = createApp();
    const before = readFileSync(path.join(root, "package.json"), "utf8");
    const { recorded, run } = fakeRunner();

    const result = await runUpgradeCheck({ root, to: "5.31", run });

    expect(readFileSync(path.join(root, "src/app/jobs/run.service.ts"), "utf8")).toBe(SERVICE);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
    expect(result.hits.map((hit) => hit.codemod)).toContain("logger-sync-calls");
    expect(result.upgrade.dryRun).toBe(false);
    expect(result.steps.map((entry) => entry.id)).toEqual([
      "copy",
      "upgrade",
      "install",
      "typings",
      "typecheck",
      "doctor",
      "unit-tests",
    ]);
    expect(recorded.map((entry) => entry.command.args.at(-1))).toEqual([
      "install",
      "generate.typings",
      "typecheck",
      "doctor",
    ]);
    expect(existsSync(result.scratch)).toBe(false);
  });

  it("copies the project without node_modules, .git and storage", async () => {
    const root = createApp();
    const { recorded, run } = fakeRunner();

    await runUpgradeCheck({ root, to: "5.31", run });

    expect(recorded[0]?.scratchFiles).toEqual(["package-lock.json", "package.json", "src"]);
  });

  it("applies the upgrade inside the copy before installing", async () => {
    const root = createApp();
    const seen: string[] = [];

    await runUpgradeCheck({
      root,
      to: "5.31",
      run: async (command) => {
        seen.push(readFileSync(path.join(command.cwd, "package.json"), "utf8"));

        return { exitCode: 0, output: "", timedOut: false };
      },
    });

    expect(seen[0]).toContain('"^5.31.0"');
  });

  it("installs with the manager detected on the real project", async () => {
    const root = createApp();
    rmSync(path.join(root, "package-lock.json"));
    writeFileSync(path.join(root, "yarn.lock"), "");
    const { recorded, run } = fakeRunner();

    const result = await runUpgradeCheck({ root, to: "5.31", run });

    expect(result.packageManager).toBe("yarn");
    expect(result.packageManagerReason).toContain("yarn.lock");
    expect(recorded[0]?.command.command).toBe("yarn");
    expect(recorded[0]?.command.args).toEqual(["install"]);
  });

  it("caps the heap of every child and runs low priority work one command at a time", async () => {
    const root = createApp();
    const { recorded, run } = fakeRunner();

    await runUpgradeCheck({ root, to: "5.31", run, memoryMb: 2048, timeoutMinutes: 3 });

    for (const entry of recorded) {
      expect(entry.command.env.NODE_OPTIONS).toContain("--max-old-space-size=2048");
      expect(entry.command.timeoutMs).toBe(180_000);
    }
  });

  it("--skip-install installs nothing and runs no project command", async () => {
    const root = createApp();
    const { recorded, run } = fakeRunner();

    const result = await runUpgradeCheck({ root, to: "5.31", run, skipInstall: true });

    expect(recorded).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.steps.filter((entry) => entry.status === "skipped").map((entry) => entry.id)).toEqual([
      "install",
      "typings",
      "typecheck",
      "doctor",
      "unit-tests",
    ]);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("--keep leaves the copy on disk", async () => {
    const root = createApp();
    const { run } = fakeRunner();

    const result = await runUpgradeCheck({ root, to: "5.31", run, keep: true });

    roots.push(result.scratch);
    expect(result.kept).toBe(true);
    expect(existsSync(path.join(result.scratch, "package.json"))).toBe(true);
    expect(formatUpgradeCheckReport(result)).toContain(result.scratch);
  });

  it("skips what needs the new version when the install fails", async () => {
    const root = createApp();
    const { recorded, run } = fakeRunner(() => ({ exitCode: 1, output: "ERESOLVE" }));

    const result = await runUpgradeCheck({ root, to: "5.31", run });

    expect(recorded).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.steps.find((entry) => entry.id === "install")).toMatchObject({
      status: "failed",
      output: "ERESOLVE",
    });
    expect(result.steps.find((entry) => entry.id === "typecheck")?.status).toBe("skipped");
  });

  it("reports a failing typecheck and a timed out step", async () => {
    const root = createApp();
    const { run } = fakeRunner((command) =>
      command.args.at(-1) === "typecheck"
        ? { exitCode: 2, output: "src/a.ts(1,1): error TS2345" }
        : command.args.at(-1) === "doctor"
          ? { exitCode: 1, timedOut: true }
          : {},
    );

    const result = await runUpgradeCheck({ root, to: "5.31", run });

    expect(result.ok).toBe(false);
    expect(result.steps.find((entry) => entry.id === "typecheck")?.output).toContain("TS2345");
    expect(result.steps.find((entry) => entry.id === "doctor")?.detail).toContain("timed out");
    expect(result.steps.find((entry) => entry.id === "typings")?.status).toBe("passed");
  });

  it("runs the app's unit project through its own vitest when installed", async () => {
    const root = createApp();
    const { recorded, run } = fakeRunner((command) => {
      if (command.args.at(-1) === "install") {
        mkdirSync(path.join(command.cwd, "node_modules/vitest"), { recursive: true });
        writeFileSync(
          path.join(command.cwd, "node_modules/vitest/package.json"),
          JSON.stringify({ bin: { vitest: "vitest.mjs" } }),
        );
        writeFileSync(path.join(command.cwd, "node_modules/vitest/vitest.mjs"), "");
      }

      return {};
    });

    const result = await runUpgradeCheck({ root, to: "5.31", run });
    const tests = recorded.at(-1)?.command;

    expect(tests?.args.slice(1)).toEqual(["run", "--project", "unit", "--passWithNoTests"]);
    expect(tests?.env.NODE_ENV).toBe("test");
    expect(result.steps.at(-1)).toMatchObject({ id: "unit-tests", status: "passed" });
  });

  it("refuses a scratch directory inside the project", async () => {
    const root = createApp();
    const { recorded, run } = fakeRunner();

    await expect(runUpgradeCheck({ root, to: "5.31", run, scratchRoot: root })).rejects.toThrow(
      /inside the project/,
    );
    expect(recorded).toEqual([]);
    expect(readdirSync(root).some((name) => name.startsWith("warlock-upgrade-check-"))).toBe(false);
  });

  it("is wired into the command: --json output and a non-zero exit when a step fails", async () => {
    const root = createApp();
    const logs: string[] = [];
    const { run } = fakeRunner((command) => (command.args.at(-1) === "doctor" ? { exitCode: 1 } : {}));

    const code = await runUpgradeCommand(
      { to: "5.31", check: true, json: true },
      { root, run },
      { log: (message) => logs.push(message), error: () => undefined },
    );

    expect(code).toBe(1);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({ ok: false, to: "5.31" });
  });

  it("formats the report with hits, results and the untouched-project note", async () => {
    const root = createApp();
    const { run } = fakeRunner();
    const report = formatUpgradeCheckReport(await runUpgradeCheck({ root, to: "5.31", run }));

    expect(report).toContain("your project was not changed");
    expect(report).toContain("logger-sync-calls");
    expect(report).toContain("Package manager:");
    expect(report).toContain("warlock doctor");
  });
});
