import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectPackageManagerDetails,
  getInstallCommand,
  type PackageManager,
} from "../updater/package-manager";
import { pruneFamilyLockEntries } from "../updater/prune-npm-lockfile";
import { loadTsMorph } from "./load-ts-morph";
import {
  detectInstalledVersion,
  type RunUpgradeOptions,
  runUpgrade,
  UpgradeUsageError,
} from "./run-upgrade";
import type { UpgradeResult } from "./types";

/** The stages of `warlock upgrade --check`, in the order they run. */
export type UpgradeCheckStepId =
  | "copy"
  | "upgrade"
  | "install"
  | "typings"
  | "typecheck"
  | "doctor"
  | "unit-tests";

export type UpgradeCheckStep = {
  id: UpgradeCheckStepId;
  title: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  /** The command that ran (absent for in-process steps and skipped ones). */
  command?: string;
  exitCode?: number;
  /** Why the step failed or was skipped. */
  detail?: string;
  /** The tail of the command's output, kept for failed steps only. */
  output?: string;
};

/** A breaking change from the range that touched (or needs a decision in) this app. */
export type UpgradeCheckHit = {
  codemod: string;
  version: string;
  title: string;
  skill: string;
  /** Places the upgrade rewrote in the scratch copy. */
  applied: number;
  /** Places that need a decision. */
  manual: number;
  files: string[];
};

export type UpgradeCheckResult = {
  from: string;
  to: string;
  /** The real project; it is never written. */
  root: string;
  /** The scratch copy the upgrade ran in. */
  scratch: string;
  /** Whether the scratch copy was left on disk (`--keep`). */
  kept: boolean;
  packageManager: PackageManager;
  packageManagerReason: string;
  /** The upgrade as applied in the scratch copy. */
  upgrade: UpgradeResult;
  /** Breaking changes that hit the app. */
  hits: UpgradeCheckHit[];
  steps: UpgradeCheckStep[];
  /** True when no step failed. Skipped steps do not fail the check. */
  ok: boolean;
};

/** One child process the check wants to run. */
export type CheckCommand = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
};

export type CheckCommandOutcome = {
  exitCode: number;
  /** Tail of stdout and stderr combined. */
  output: string;
  timedOut: boolean;
};

export type UpgradeCheckOptions = Pick<RunUpgradeOptions, "to" | "from" | "codemods"> & {
  /** App root. Defaults to the current directory. */
  root?: string;
  /** Copy and apply the upgrade, but install nothing and run no project command. */
  skipInstall?: boolean;
  /** Leave the scratch copy on disk and report where it is. */
  keep?: boolean;
  /** Per-command time limit in minutes. Default 20. */
  timeoutMinutes?: number;
  /** Heap cap (MB) for every Node process the check starts. Default 4096. */
  memoryMb?: number;
  /** Where the scratch copy goes. Default: the OS temp directory. */
  scratchRoot?: string;
  /** Override how ts-morph is loaded (tests). */
  loadTsMorph?: RunUpgradeOptions["loadTsMorph"];
  /** Override how child processes run (tests). */
  run?: (command: CheckCommand) => Promise<CheckCommandOutcome>;
};

const DEFAULT_TIMEOUT_MINUTES = 20;
const DEFAULT_MEMORY_MB = 4096;
/** How much command output a failed step keeps. */
const OUTPUT_TAIL = 6000;

/** Whether a path of the project is left out of the scratch copy. */
export function isExcludedFromScratch(relative: string): boolean {
  const segments = relative.split(/[\\/]/).filter(Boolean);

  if (segments.length === 0) return false;

  return (
    segments.includes("node_modules") || segments.includes(".git") || segments[0] === "storage"
  );
}

/**
 * Rehearse an upgrade on a copy of the app. The project (minus `node_modules`,
 * `.git` and `storage`) is copied to a scratch directory, the upgrade is
 * applied there, dependencies are installed there with the app's own package
 * manager, and typings, typecheck, `warlock doctor` and the `unit` Vitest
 * project run against the result. The real project is never written.
 */
export async function runUpgradeCheck(options: UpgradeCheckOptions): Promise<UpgradeCheckResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const from = options.from ?? detectInstalledVersion(root);
  const run = options.run ?? runCommand;
  const timeoutMs = (options.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000;
  const memoryMb = options.memoryMb ?? DEFAULT_MEMORY_MB;

  // Detected on the real project: the copy has no node_modules to read markers from.
  const detection = await detectPackageManagerDetails(root);

  const scratch = mkdtempSync(
    path.join(options.scratchRoot ?? os.tmpdir(), "warlock-upgrade-check-"),
  );

  try {
    if (isInside(root, scratch)) {
      throw new UpgradeUsageError(
        `The scratch directory (${scratch}) is inside the project. Point TMPDIR at a directory outside ${root}.`,
      );
    }

    const steps: UpgradeCheckStep[] = [];

    await step(steps, "copy", "Copy the project to a scratch directory", async () => {
      cpSync(root, scratch, {
        recursive: true,
        filter: (source) => !isExcludedFromScratch(path.relative(root, source)),
      });
    });

    if (steps[0]?.status === "failed") {
      throw new UpgradeUsageError(steps[0].detail ?? "The project could not be copied.");
    }

    const loader = options.loadTsMorph ?? loadTsMorph;

    const upgrade = await step(
      steps,
      "upgrade",
      `Apply the upgrade to ${options.to} (package.json and codemods)`,
      () =>
        runUpgrade({
          root: scratch,
          to: options.to,
          from,
          ...(options.codemods && { codemods: options.codemods }),
          // ts-morph resolves from the real project: the copy has no node_modules.
          loadTsMorph: () => loader(root),
        }),
    );

    if (!upgrade) {
      // The upgrade itself failed: surface its error instead of a partial report.
      const failed = steps.find((entry) => entry.status === "failed");

      throw new UpgradeUsageError(
        failed?.detail ?? "The upgrade could not be applied to the copy.",
      );
    }

    const base = { cwd: scratch, timeoutMs };
    const installCommand = getInstallCommand(detection.packageManager);
    const skipReason = options.skipInstall ? "--skip-install" : undefined;
    let installed = false;

    if (skipReason) {
      steps.push(skipped("install", `Install with ${detection.packageManager}`, skipReason));
    } else {
      const [binary = "npm", ...installArgs] = installCommand.split(" ");

      if (detection.packageManager === "npm") pruneScratchLockfile(scratch);

      const result = await commandStep(
        steps,
        "install",
        `Install with ${detection.packageManager}`,
        installCommand,
        run,
        { ...base, command: binary, args: installArgs, env: childEnv(memoryMb, "development") },
      );

      installed = result;
    }

    const warlockBin = path.join(
      scratch,
      "node_modules",
      "@warlock.js",
      "core",
      "bin",
      "warlock.js",
    );
    const projectCommands: Array<{
      id: UpgradeCheckStepId;
      title: string;
      args: string[];
      env: NodeJS.ProcessEnv;
    }> = [
      {
        id: "typings",
        title: "Generate typings",
        args: [warlockBin, "generate.typings"],
        env: childEnv(memoryMb, "development"),
      },
      {
        id: "typecheck",
        title: "Typecheck",
        args: [warlockBin, "typecheck"],
        env: childEnv(memoryMb, "development"),
      },
      {
        id: "doctor",
        title: "warlock doctor",
        args: [warlockBin, "doctor"],
        env: childEnv(memoryMb, "development"),
      },
    ];

    for (const entry of projectCommands) {
      if (!installed) {
        steps.push(
          skipped(
            entry.id,
            entry.title,
            skipReason ?? "the install failed, so the new version is not available",
          ),
        );
        continue;
      }

      await commandStep(
        steps,
        entry.id,
        entry.title,
        `warlock ${entry.args.slice(1).join(" ")}`,
        run,
        {
          ...base,
          command: process.execPath,
          args: entry.args,
          env: entry.env,
        },
      );
    }

    if (!installed) {
      steps.push(
        skipped(
          "unit-tests",
          "Unit test project",
          skipReason ?? "the install failed, so the new version is not available",
        ),
      );
    } else {
      const vitest = resolveVitestEntry(scratch);

      if (!vitest) {
        steps.push(
          skipped("unit-tests", "Unit test project", "vitest is not installed in the app"),
        );
      } else {
        const outcome = await commandStep(
          steps,
          "unit-tests",
          "Unit test project",
          "vitest run --project unit",
          run,
          {
            ...base,
            command: process.execPath,
            args: [vitest, "run", "--project", "unit", "--passWithNoTests"],
            env: childEnv(memoryMb, "test"),
          },
        );

        // An app without a `unit` project has nothing to run: report it, do not fail it.
        const last = steps[steps.length - 1];

        if (!outcome && last && /no projects matched|project.*not found/i.test(last.output ?? "")) {
          steps[steps.length - 1] = skipped(
            "unit-tests",
            "Unit test project",
            "the app has no `unit` Vitest project",
          );
        }
      }
    }

    return {
      from,
      to: options.to,
      root,
      scratch,
      kept: options.keep === true,
      packageManager: detection.packageManager,
      packageManagerReason: detection.reason,
      upgrade,
      hits: collectHits(upgrade),
      steps,
      ok: steps.every((entry) => entry.status !== "failed"),
    };
  } finally {
    if (!options.keep) rmSync(scratch, { recursive: true, force: true });
  }
}

/** The breaking changes that changed code or left a place to review in this app. */
export function collectHits(upgrade: UpgradeResult): UpgradeCheckHit[] {
  const hits: UpgradeCheckHit[] = [];

  for (const codemod of upgrade.codemods) {
    if (codemod.applied + codemod.manual === 0) continue;

    const applied = upgrade.applied.filter((item) => item.codemod === codemod.id);
    const manual = upgrade.manual.filter((item) => item.codemod === codemod.id);

    hits.push({
      codemod: codemod.id,
      version: codemod.version,
      title: codemod.title,
      skill: manual[0]?.skill ?? "upgrade-from-5-29",
      applied: codemod.applied,
      manual: codemod.manual,
      files: [...new Set([...applied, ...manual].map((item) => item.file))].sort(),
    });
  }

  return hits;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Run an in-process step, recording its outcome; a throw becomes a failed step. */
async function step<T>(
  steps: UpgradeCheckStep[],
  id: UpgradeCheckStepId,
  title: string,
  body: () => Promise<T>,
): Promise<T | undefined> {
  const started = Date.now();

  try {
    const value = await body();

    steps.push({ id, title, status: "passed", durationMs: Date.now() - started });

    return value;
  } catch (error) {
    steps.push({
      id,
      title,
      status: "failed",
      durationMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    });

    return undefined;
  }
}

/** Run a child-process step; resolves to whether it passed. */
async function commandStep(
  steps: UpgradeCheckStep[],
  id: UpgradeCheckStepId,
  title: string,
  label: string,
  run: (command: CheckCommand) => Promise<CheckCommandOutcome>,
  command: CheckCommand,
): Promise<boolean> {
  const started = Date.now();

  try {
    const outcome = await run(command);
    const passed = outcome.exitCode === 0 && !outcome.timedOut;

    steps.push({
      id,
      title,
      status: passed ? "passed" : "failed",
      durationMs: Date.now() - started,
      command: label,
      exitCode: outcome.exitCode,
      ...(outcome.timedOut && {
        detail: `timed out after ${Math.round(command.timeoutMs / 60_000)} minute(s)`,
      }),
      ...(!passed && { output: outcome.output }),
    });

    return passed;
  } catch (error) {
    steps.push({
      id,
      title,
      status: "failed",
      durationMs: Date.now() - started,
      command: label,
      detail: error instanceof Error ? error.message : String(error),
    });

    return false;
  }
}

function skipped(id: UpgradeCheckStepId, title: string, reason: string): UpgradeCheckStep {
  return { id, title, status: "skipped", durationMs: 0, detail: `skipped: ${reason}` };
}

/** The environment of every child: a heap cap, and an environment that matches the command. */
function childEnv(memoryMb: number, nodeEnv: "development" | "test"): NodeJS.ProcessEnv {
  const inherited = (process.env.NODE_OPTIONS ?? "")
    .replace(/--max-old-space-size=\d+/g, "")
    .trim();

  return {
    ...process.env,
    NODE_ENV: nodeEnv,
    NODE_OPTIONS: `${inherited} --max-old-space-size=${memoryMb}`.trim(),
    CI: "1",
  };
}

/**
 * npm re-resolves the Warlock family together only when its lock entries are
 * gone, exactly as `warlock update` prepares it. Done on the copy.
 */
function pruneScratchLockfile(scratch: string): void {
  const lockfile = path.join(scratch, "package-lock.json");

  if (!existsSync(lockfile)) return;

  try {
    const parsed = JSON.parse(readFileSync(lockfile, "utf8"));

    if (pruneFamilyLockEntries(parsed).length > 0) {
      writeFileSync(lockfile, `${JSON.stringify(parsed, null, 2)}\n`);
    }
  } catch {
    // an unreadable lockfile is left for the installer to report
  }
}

/** The copy's own Vitest entry, or `undefined` when it is not installed. */
function resolveVitestEntry(scratch: string): string | undefined {
  try {
    const manifestPath = path.join(scratch, "node_modules", "vitest", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.vitest;
    const entry = path.join(path.dirname(manifestPath), bin ?? "vitest.mjs");

    return existsSync(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run one child process at low priority, sequentially with the others, killing
 * its whole process group on timeout. Only processes started here are signalled.
 */
export function runCommand(command: CheckCommand): Promise<CheckCommandOutcome> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      shell: process.platform === "win32",
    });

    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, 10);
      } catch {
        // priority is a courtesy to the other processes on the machine
      }
    }

    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-OUTPUT_TAIL);
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid !== undefined)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // already gone
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 5000).unref();
    }, command.timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `${output}\n${error.message}`.trim(), timedOut });
    });

    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? (signal ? 1 : 0), output, timedOut });
    });
  });
}
