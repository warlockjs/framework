import path from "node:path";
import { format, stripVTControlCharacters } from "node:util";
import type { CommandActionData } from "../commands/types";

/**
 * What a generation command did (or, in a dry run, would do) to one file.
 *
 * - `create` — the file did not exist and is written.
 * - `overwrite` — the file existed and is replaced because `--force` was given.
 * - `update` — an existing file is edited in place (a route appended, a key merged).
 * - `unchanged` — the file already holds exactly the generated content.
 * - `skip` — the file exists and is left alone; `reason` says why.
 */
export type GenerationFileAction = "create" | "overwrite" | "update" | "unchanged" | "skip";

export type GenerationFileRecord = {
  /** Path relative to the current working directory, with `/` separators. */
  path: string;
  type: GenerationFileAction;
  reason?: string;
};

/**
 * The machine-readable result `--json` prints on stdout, one JSON document.
 *
 * `schemaVersion` changes only when a field is removed or changes meaning;
 * new fields may be added to version 1.
 */
export type GenerationReport = {
  schemaVersion: 1;
  /** The command as typed, e.g. `"make endpoint"` or `"add"`. */
  command: string;
  dryRun: boolean;
  ok: boolean;
  /** Files created, overwritten or updated (or, in a dry run, that would be). */
  written: string[];
  /** Files left alone because they already exist, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
  /** Every file the command touched, in the order it touched them. */
  files: GenerationFileRecord[];
  /** Command-specific facts, e.g. the dependencies `add` installs. */
  details: Record<string, unknown>;
  /** Everything the command printed, without colours. */
  messages: string[];
  /** Why the command failed, when `ok` is false. */
  error?: string;
};

type GenerationRunState = {
  command: string;
  dryRun: boolean;
  files: Map<string, GenerationFileRecord>;
  /** Dry-run overlay: content a real run would have written, keyed by absolute path. */
  pending: Map<string, string>;
  details: Record<string, unknown>;
  messages: string[];
};

let activeRun: GenerationRunState | undefined;

/** Render an absolute path relative to the cwd, `/`-separated, for reports and logs. */
export function toReportPath(target: string): string {
  const relative = path.relative(process.cwd(), path.resolve(target)) || target;

  return relative.split(path.sep).join("/");
}

/**
 * Start recording a generation command. Every write made through
 * `generation-fs` (and the `generate.*` writer) is recorded until
 * {@link endGenerationRun}; in a dry run nothing reaches the disk.
 */
export function beginGenerationRun(options: { command: string; dryRun: boolean }): void {
  activeRun = {
    command: options.command,
    dryRun: options.dryRun,
    files: new Map(),
    pending: new Map(),
    details: {},
    messages: [],
  };
}

/** The run being recorded, if any. */
export function currentGenerationRun(): Readonly<GenerationRunState> | undefined {
  return activeRun;
}

/** Whether the current generation command is a dry run. */
export function isGenerationDryRun(): boolean {
  return activeRun?.dryRun === true;
}

/**
 * Record what happened to one file. A file first created and later edited in
 * the same run stays `create`: the report describes the run's net effect.
 */
export function recordGeneratedFile(
  target: string,
  type: GenerationFileAction,
  reason?: string,
): void {
  if (!activeRun) return;

  const key = toReportPath(target);
  const previous = activeRun.files.get(key);

  if (previous?.type === "create" && type !== "skip") return;

  activeRun.files.set(
    key,
    reason === undefined ? { path: key, type } : { path: key, type, reason },
  );
}

/** Record a file the command deliberately left alone. */
export function recordSkippedFile(target: string, reason: string): void {
  recordGeneratedFile(target, "skip", reason);
}

/** Attach a command-specific fact to the report, e.g. `dependencies`. */
export function setGenerationDetail(key: string, value: unknown): void {
  if (!activeRun) return;

  activeRun.details[key] = value;
}

/** The dry-run overlay content for `target`, when this run "wrote" it. */
export function pendingGeneratedContent(target: string): string | undefined {
  return activeRun?.pending.get(path.resolve(target));
}

/** Keep `content` as what a dry run would have written to `target`. */
export function setPendingGeneratedContent(target: string, content: string): void {
  activeRun?.pending.set(path.resolve(target), content);
}

/** Whether any pending dry-run file lives under `directory`. */
export function hasPendingContentUnder(directory: string): boolean {
  if (!activeRun) return false;

  const prefix = path.resolve(directory) + path.sep;

  for (const file of activeRun.pending.keys()) {
    if (file.startsWith(prefix)) return true;
  }

  return false;
}

/** Stop recording and build the report. */
export function endGenerationRun(result: { ok: boolean; error?: string }): GenerationReport {
  const run = activeRun;

  activeRun = undefined;

  const files = run ? [...run.files.values()] : [];
  const report: GenerationReport = {
    schemaVersion: 1,
    command: run?.command ?? "",
    dryRun: run?.dryRun ?? false,
    ok: result.ok,
    written: files
      .filter(
        (file) => file.type === "create" || file.type === "overwrite" || file.type === "update",
      )
      .map((file) => file.path),
    skipped: files
      .filter((file) => file.type === "skip")
      .map((file) => ({ path: file.path, reason: file.reason ?? "exists" })),
    files,
    details: run?.details ?? {},
    messages: run?.messages ?? [],
  };

  if (result.error !== undefined) report.error = result.error;

  return report;
}

/**
 * Pick the line that explains a failure from what the command printed: the
 * first `Error…` line, else the last line.
 */
function failureMessage(messages: readonly string[]): string {
  const errorLine = messages.find((message) => /^\s*(?:✖\s*)?Error\b/.test(message));

  return (errorLine ?? messages[messages.length - 1] ?? "The command failed.").trim();
}

/**
 * Run a `make` / `generate.*` / `add` action under the recorder.
 *
 * `--dry-run` writes nothing. `--json` sends everything the command prints
 * to stderr and prints exactly one {@link GenerationReport} on stdout — also
 * when the command fails, including through `process.exit(1)`, so a caller
 * parsing stdout always gets a document.
 */
export async function runGenerationCommand(
  command: string,
  data: CommandActionData,
  action: (data: CommandActionData) => Promise<void>,
): Promise<void> {
  const json = data.options.json === true || data.options.j === true;
  const dryRun = data.options.dryRun === true;

  beginGenerationRun({ command, dryRun });

  if (!json) {
    try {
      await action(data);
    } finally {
      endGenerationRun({ ok: true });
    }

    return;
  }

  const run = activeRun;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  let printed = false;

  const capture =
    (forward: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      run?.messages.push(stripVTControlCharacters(format(...args)));
      forward(...args);
    };

  // stdout carries the report and nothing else.
  console.log = capture(originalError);
  console.info = capture(originalError);
  console.warn = capture(originalWarn);
  console.error = capture(originalError);

  const restoreConsole = (): void => {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  };

  const print = (report: GenerationReport): void => {
    if (printed) return;

    printed = true;
    process.stdout.write(`${JSON.stringify(report)}\n`);
  };

  // Generators stop with `process.exit(1)` on bad input. The report still has
  // to reach stdout, and `exit` listeners run synchronously before the process
  // ends (stdout writes to a pipe or file are synchronous on Linux and macOS).
  const onExit = (code: number): void => {
    const messages = run?.messages ?? [];

    print(
      code === 0
        ? endGenerationRun({ ok: true })
        : endGenerationRun({ ok: false, error: failureMessage(messages) }),
    );
  };

  process.once("exit", onExit);

  try {
    await action(data);
    print(endGenerationRun({ ok: true }));
  } catch (error) {
    print(
      endGenerationRun({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    throw error;
  } finally {
    process.off("exit", onExit);
    restoreConsole();
  }
}

/** The options every generation command accepts, for `command({ options })`. */
export const generationOutputOptions = [
  {
    text: "--dry-run",
    description: "Preview the files that would be written or skipped without writing anything",
    type: "boolean" as const,
  },
  {
    text: "--json",
    description:
      "Print one JSON report on stdout (files written, files skipped because they exist, messages)",
    type: "boolean" as const,
  },
];
