import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGeneratorArgs, type GeneratorSpec } from "./generator-spec";
import {
  compareSnapshots,
  copyProjectScope,
  forEachSandboxFile,
  forEachScopedFile,
  isBinary,
  type SnapshotChange,
  snapshotFiles,
} from "./project-files";
import {
  type CliRun,
  type CliRunner,
  DEFAULT_GENERATION_TIMEOUT_MS,
  describeRun,
  resolveCliEntry,
  spawnCli,
} from "./run-cli";
import { unifiedDiff } from "./unified-diff";

/** The largest diff kept per file; a longer one is cut with a note. */
export const MAX_FILE_DIFF_BYTES = 200 * 1024;

/** One file a generation creates, changes or removes. */
export type GeneratedFile = {
  /** Project-relative POSIX path. */
  path: string;
  status: "created" | "modified" | "deleted";
  /** Unified diff against the project's current content (`""` for a binary file). */
  diff: string;
  /** Set when the file is binary; `diff` is then empty. */
  binary?: boolean;
};

/** What a generation would do (or did). */
export type GenerationPlan = {
  spec: GeneratorSpec;
  /** The argv that ran, starting with `warlock`. */
  command: string[];
  /** Whether the command exited 0. A failed run usually lists no files. */
  ok: boolean;
  exitCode: number | null;
  files: GeneratedFile[];
  /** The command's stdout and stderr, ANSI stripped and capped. */
  output: string;
};

/** Options every backend accepts. */
export type GenerationPlanOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** Default {@link DEFAULT_GENERATION_TIMEOUT_MS}. */
  timeoutMs?: number;
};

/**
 * Computes what a generation would change without touching the project.
 *
 * The seam a native `warlock generate.* --dry-run --json` can implement later;
 * {@link sandboxBackend} implements it by generating into a throwaway copy.
 */
export type GenerationBackend = {
  plan(spec: GeneratorSpec, options?: GenerationPlanOptions): Promise<GenerationPlan>;
};

/** Options of {@link sandboxBackend}. */
export type SandboxBackendOptions = {
  /** The `warlock` bin to run. Default: {@link resolveCliEntry}. */
  cliEntry?: string;
  /** How the CLI runs. Default: {@link spawnCli}. */
  runner?: CliRunner;
  /** Where sandboxes are created. Default: `os.tmpdir()`. */
  tempDirectory?: string;
};

function readOrNull(file: string): Buffer | null {
  return existsSync(file) ? readFileSync(file) : null;
}

function capDiff(diff: string): string {
  return diff.length > MAX_FILE_DIFF_BYTES
    ? `${diff.slice(0, MAX_FILE_DIFF_BYTES)}\n… (diff truncated)\n`
    : diff;
}

/**
 * Build the {@link GeneratedFile} for one change from the two contents, or
 * `undefined` when they are byte-identical (a file rewritten unchanged).
 */
function describeChange(
  change: SnapshotChange,
  before: Buffer | null,
  after: Buffer | null,
): GeneratedFile | undefined {
  if (before !== null && after !== null && before.equals(after)) return undefined;

  const status: GeneratedFile["status"] =
    before === null ? "created" : after === null ? "deleted" : "modified";

  if ((before && isBinary(before)) || (after && isBinary(after))) {
    return { path: change.path, status, diff: "", binary: true };
  }

  return {
    path: change.path,
    status,
    diff: capDiff(
      unifiedDiff({
        path: change.path,
        before: before === null ? null : before.toString("utf8"),
        after: after === null ? null : after.toString("utf8"),
      }),
    ),
  };
}

function planFrom(
  spec: GeneratorSpec,
  args: string[],
  run: CliRun,
  files: GeneratedFile[],
): GenerationPlan {
  return {
    spec,
    command: ["warlock", ...args],
    ok: run.exitCode === 0 && !run.timedOut,
    exitCode: run.exitCode,
    files,
    output: describeRun(run),
  };
}

/**
 * The sandbox {@link GenerationBackend}: copies the project's root files and
 * `src/` tree (never `.env` files) into a temporary directory, links the
 * project's `node_modules` into it, runs the real `warlock` command there,
 * and reports every file that changed as a unified diff against the project.
 * The project is never written; the sandbox is always removed.
 *
 * `add` runs with `--no-install`: package.json shows the dependencies it
 * would record, and nothing is downloaded.
 *
 * @example
 * const plan = await sandboxBackend().plan(
 *   { type: "make", generator: "service", name: "users/send-welcome" },
 *   { cwd: projectRoot },
 * );
 * plan.files.map((file) => `${file.status} ${file.path}`);
 */
export function sandboxBackend(options: SandboxBackendOptions = {}): GenerationBackend {
  const runner = options.runner ?? spawnCli;

  return {
    async plan(spec, planOptions = {}) {
      const cwd = path.resolve(planOptions.cwd ?? process.cwd());
      const args = buildGeneratorArgs(spec, { install: false });
      const sandbox = mkdtempSync(
        path.join(options.tempDirectory ?? os.tmpdir(), "warlock-generate-"),
      );

      try {
        copyProjectScope(cwd, sandbox);

        const before = snapshotFiles(sandbox, forEachSandboxFile);
        const run = await runner({
          entry: options.cliEntry ?? resolveCliEntry(),
          args,
          cwd: sandbox,
          timeoutMs: planOptions.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS,
        });
        const after = snapshotFiles(sandbox, forEachSandboxFile);
        const files = compareSnapshots(before, after).flatMap((change) => {
          // Compared with the PROJECT, not the sandbox copy: a file outside the
          // copied scope that the project already has is a change, not a creation.
          const file = describeChange(
            change,
            readOrNull(path.join(cwd, change.path)),
            change.status === "deleted" ? null : readOrNull(path.join(sandbox, change.path)),
          );

          return file ? [file] : [];
        });

        return planFrom(spec, args, run, files);
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  };
}

/** Options of {@link applyGeneration}. */
export type ApplyGenerationOptions = GenerationPlanOptions & {
  /** The `warlock` bin to run. Default: {@link resolveCliEntry}. */
  cliEntry?: string;
  /** How the CLI runs. Default: {@link spawnCli}. */
  runner?: CliRunner;
  /** For `add`: install the packages it records. Default `true`. */
  install?: boolean;
};

/**
 * Run a generation in the real project and report what it changed, as a
 * {@link GenerationPlan} whose diffs compare the files before and after.
 *
 * Only the generation scope (root files and `src/`, never `.env` files) is
 * compared. This WRITES the project: `warlock mcp` exposes it only with
 * `--allow-writes`.
 */
export async function applyGeneration(
  spec: GeneratorSpec,
  options: ApplyGenerationOptions = {},
): Promise<GenerationPlan> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const args = buildGeneratorArgs(spec, { install: options.install ?? true });
  const contents = new Map<string, Buffer>();

  forEachScopedFile(cwd, (absolute, relative) => {
    contents.set(relative, readFileSync(absolute));
  });

  const before = snapshotFiles(cwd, forEachScopedFile);
  const run = await (options.runner ?? spawnCli)({
    entry: options.cliEntry ?? resolveCliEntry(),
    args,
    cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS,
  });
  const after = snapshotFiles(cwd, forEachScopedFile);
  const files = compareSnapshots(before, after).flatMap((change) => {
    const file = describeChange(
      change,
      contents.get(change.path) ?? null,
      change.status === "deleted" ? null : readOrNull(path.join(cwd, change.path)),
    );

    return file ? [file] : [];
  });

  return planFrom(spec, args, run, files);
}
