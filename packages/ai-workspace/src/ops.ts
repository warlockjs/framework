import path from "node:path";
import { fs } from "@warlock.js/fs";
import { applyReplacement, type AppliedReplacementOptions } from "./edit/apply-replacement";
import { WorkspaceEditError, WorkspacePolicyError } from "./errors";
import { runAfterEdit } from "./hooks/after-edit";
import { ShellOutputStreamer } from "./hooks/shell-output";
import { OutputSpiller, splitLines } from "./output/spill";
import { globToRegExp, isInside, matchesAnyGlob } from "./policy/jail";
import { buildCommandEnv, resolveInJail } from "./policy/policy";
import { refusalReason, samePattern } from "./policy/approval-helpers";
import { checkShellCommand } from "./policy/shell-check";
import { resolveShell, type ResolvedShell } from "./policy/shell-interpreter";
import { DEFAULT_MAX_BACKGROUND_JOBS, ShellJobs } from "./shell-jobs";
import { executePatch } from "./patch/execute-patch";
import {
  DEFAULT_SEARCH_CONCURRENCY,
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_SKIP_DIRS,
  staticGlobPrefix,
  walkFiles,
  type WalkResult,
} from "./search/walk";
import type {
  ApplyPatchInput,
  ApplyPatchResult,
  EditFileInput,
  EditFileResult,
  ExecOptions,
  WorkspaceBackendExecResult,
  GrepMatch,
  GlobResult,
  GrepResult,
  ListDirEntry,
  ListDirEntryType,
  ListDirOptions,
  ListDirResult,
  MultiEditInput,
  MultiEditResult,
  ReadFileResult,
  RunShellResult,
  ShellJobInfo,
  ShellOutputOptions,
  ShellOutputResult,
  StartShellOptions,
  WorkspaceBackend,
  WorkspaceCommandPattern,
  WorkspaceOps,
  WorkspacePolicy,
  WorkspaceShellAsk,
  WorkspaceShellOnAsk,
  WorkspaceEditTool,
  WorkspaceTruncation,
} from "./contracts";

/** Default line window a read returns when the policy sets no `defaultLines`. */
const DEFAULT_READ_LINES = 2000;
/** Hard ceiling on grep matches returned, so a broad pattern can't flood. */
const DEFAULT_MAX_GREP_MATCHES = 1000;
/** Default per-command output byte cap when the policy sets none. */
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
/** Default `list.ignore` when the policy sets none. */
const DEFAULT_LIST_IGNORE: readonly string[] = ["node_modules", ".git"];
/** Default deepest `depth` a listing may ask for. */
const DEFAULT_LIST_MAX_DEPTH = 5;
/** Default most entries one listing returns. */
const DEFAULT_LIST_MAX_ENTRIES = 500;
/** Most edits one `multiEdit` call may carry. */
export const MAX_MULTI_EDITS = 100;
/**
 * Exit code reported for a command refused because its signal was already
 * aborted (the shell convention for an interrupted command). Callers should
 * branch on `cancelled`, not on this number.
 */
const CANCELLED_BEFORE_START_EXIT_CODE = 130;
/**
 * Hard ceiling on `grep` pattern length. A model-controlled regex has no
 * legitimate reason to be this long; longer patterns are rejected outright
 * rather than compiled.
 */
const MAX_GREP_PATTERN_LENGTH = 200;
/**
 * Hard ceiling on the number of characters of a single line handed to
 * `RegExp#test` during a `grep`. Catastrophic backtracking is exponential
 * in input length, so bounding the input scanned per call bounds the
 * worst-case time a single pathological line can cost — lines longer than
 * this are skipped rather than scanned.
 */
const MAX_GREP_LINE_SCAN_LENGTH = 2000;

/** The `cat -n` prefix for a line: right-aligned number (min width 6) and a tab. */
function linePrefix(lineNumber: number): string {
  return `${String(lineNumber).padStart(6, " ")}\t`;
}

/**
 * Clip `value` to at most `maxBytes` UTF-8 bytes without splitting a
 * character: the cut backs off over continuation bytes (`10xxxxxx`) to the
 * start of the character it would have split, so the result never carries
 * a replacement character.
 */
function clipUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return { value, truncated: false };
  }

  let cut = Math.max(0, maxBytes);

  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) {
    cut--;
  }

  return { value: bytes.subarray(0, cut).toString("utf8"), truncated: true };
}

/**
 * Number a window of lines `cat -n` style, keeping the joined output within
 * `maxBytes` UTF-8 bytes (prefixes and newlines included) when a cap is set.
 * A line that does not fit whole is clipped on a character boundary; it is
 * still counted as returned when its prefix and at least one character fit.
 */
function numberWindow(
  lines: string[],
  startLine: number,
  maxBytes: number | undefined,
): { content: string; returnedLines: number; bytesCapped: boolean } {
  const parts: string[] = [];
  let used = 0;

  for (let index = 0; index < lines.length; index++) {
    const prefix = linePrefix(startLine + index);
    const numbered = prefix + lines[index];
    const separator = parts.length > 0 ? 1 : 0;

    if (maxBytes === undefined) {
      parts.push(numbered);

      continue;
    }

    const cost = separator + Buffer.byteLength(numbered, "utf8");

    if (used + cost <= maxBytes) {
      parts.push(numbered);
      used += cost;

      continue;
    }

    const room = maxBytes - used - separator - Buffer.byteLength(prefix, "utf8");
    const clipped = room > 0 ? clipUtf8(lines[index] ?? "", room).value : "";

    if (clipped.length > 0) {
      parts.push(prefix + clipped);
    }

    return { content: parts.join("\n"), returnedLines: parts.length, bytesCapped: true };
  }

  return { content: parts.join("\n"), returnedLines: parts.length, bytesCapped: false };
}

/**
 * Clip a captured stream at `maxBytes` (measured in UTF-8 bytes), on a
 * character boundary. Returns the possibly-clipped string plus whether
 * clipping occurred.
 */
function capOutput(value: string, maxBytes: number): { value: string; truncated: boolean } {
  return clipUtf8(value, maxBytes);
}

/**
 * A quantifier: `+`, `*`, `?`, or a `{m,n}` bound.
 */
const QUANTIFIER_SOURCE = String.raw`[+*?]|\{\d*,?\d*\}`;

/**
 * Heuristic catastrophic-backtracking detector: flags a quantified group
 * that itself contains a quantifier (e.g. `(a+)+`, `(a*)*`, `(.+)*`) —
 * the classic exponential-blowup shape. Not a full regex-safety analyzer
 * (it won't catch every ReDoS shape, e.g. quantified alternation like
 * `(a|a)+`), but it rejects the shape an agent is most likely to emit,
 * intentionally or via prompt injection.
 */
const NESTED_QUANTIFIER_PATTERN = new RegExp(
  String.raw`\([^()]*(?:${QUANTIFIER_SOURCE})[^()]*\)(?:${QUANTIFIER_SOURCE})`,
);

/**
 * Whether `pattern` is safe enough to compile and run against workspace
 * content: within the length cap and free of the nested-quantifier shape
 * that causes catastrophic regex backtracking (ReDoS).
 */
function isSafeGrepPattern(pattern: string): boolean {
  if (pattern.length > MAX_GREP_PATTERN_LENGTH) {
    return false;
  }

  return !NESTED_QUANTIFIER_PATTERN.test(pattern);
}

/**
 * The internal, single-instance implementation of {@link WorkspaceOps}.
 * Holds the backend + policy and is the one place the jail, command
 * gating, read caps, and the read-before-edit guard are enforced — both
 * the agent-facing tools and the human-facing direct methods funnel
 * through this object, so there is exactly one set of rules.
 */
/**
 * State an ops layer shares with the other projections of the same
 * workspace (`readonly()`, `scope()`): the background commands it owns.
 */
export interface OpsRuntime {
  /** The workspace's background commands. */
  jobs: ShellJobs;
  /** Patterns the host approved with `remember`, shared by every view of the workspace. */
  approvals?: WorkspaceCommandPattern[];
}

class Ops implements WorkspaceOps {
  /**
   * Tail of the mutation chain per resolved absolute path. Writes, edits and
   * removes on the same path run one after another, so two tool calls the
   * agent dispatches concurrently cannot both read the same content, both
   * pass the stale-hash guard and silently drop one edit: the second one
   * re-reads after the first has written.
   */
  private readonly pathLocks = new Map<string, Promise<void>>();

  /** The shell `policy.shell.interpreter` resolves to on this host, resolved once. */
  private readonly resolvedShell: ResolvedShell;

  /** Patterns approved with `remember` (shared through the runtime). */
  private readonly approvals: WorkspaceCommandPattern[];

  /** Saves oversized output to files when `output.spillDir` is set. */
  private readonly spiller: OutputSpiller;

  public constructor(
    private readonly backend: WorkspaceBackend,
    private readonly policy: WorkspacePolicy,
    private readonly runtime: OpsRuntime,
  ) {
    this.resolvedShell = resolveShell(policy.shell);
    this.approvals = runtime.approvals ?? [];
    this.spiller = new OutputSpiller(backend, policy);
  }

  /** The edit-policy settings applied to every replacement. */
  private editOptions(): AppliedReplacementOptions {
    const edit = this.policy.edit;

    return {
      matching: edit?.matching ?? "tiered",
      missHintLines: edit?.missHintLines ?? 12,
      lineEndings: edit?.lineEndings ?? "preserve",
      ...(this.policy.read?.maxBytes !== undefined
        ? { hintMaxBytes: this.policy.read.maxBytes }
        : {}),
    };
  }

  /** Run `afterEdit` for a call that wrote `paths`; `undefined` when there is no output. */
  private diagnosticsFor(
    tool: WorkspaceEditTool,
    paths: readonly string[],
  ): Promise<string | undefined> {
    return runAfterEdit(this.policy, { paths, tool });
  }

  /** Run `task` after every earlier mutation of `absolutePath` has settled. */
  private async withPathLock<T>(absolutePath: string, task: () => Promise<T>): Promise<T> {
    const previous = this.pathLocks.get(absolutePath) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);

    this.pathLocks.set(absolutePath, tail);

    try {
      await previous;

      return await task();
    } finally {
      release();

      if (this.pathLocks.get(absolutePath) === tail) {
        this.pathLocks.delete(absolutePath);
      }
    }
  }

  /**
   * Collect the files a `glob` or `grep` should look at, starting at the
   * folder the pattern is anchored to (see {@link staticGlobPrefix}).
   * `denyPaths`, `search.skipDirs` and `.gitignore` are applied before a
   * directory is listed.
   */
  private async searchFiles(
    jailRoot: string,
    pattern: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<WalkResult> {
    const prefix = pattern === undefined ? "" : staticGlobPrefix(pattern);
    const search = this.policy.search;
    let startDir = jailRoot;

    if (prefix !== "") {
      try {
        startDir = (await resolveInJail(this.policy, prefix)).absolutePath;
      } catch (error) {
        if (error instanceof WorkspacePolicyError) {
          return { files: [], truncated: false };
        }

        throw error;
      }
    }

    return walkFiles({
      backend: this.backend,
      jailRoot,
      startDir,
      denyPaths: this.policy.denyPaths ?? [],
      skipDirs: search?.skipDirs ?? DEFAULT_SEARCH_SKIP_DIRS,
      gitignore: search?.gitignore ?? true,
      maxFiles: search?.maxFiles ?? DEFAULT_SEARCH_MAX_FILES,
      concurrency: Math.max(1, search?.concurrency ?? DEFAULT_SEARCH_CONCURRENCY),
      ...(signal ? { signal } : {}),
    });
  }

  /** Whether an absolute path is a directory, by attempting to list it. */
  private async isDirectory(absPath: string): Promise<boolean> {
    try {
      await this.backend.list(absPath);

      return true;
    } catch {
      return false;
    }
  }

  public async readFile(
    inputPath: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<ReadFileResult> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath, "read");
    const raw = await this.backend.readFile(absolutePath);

    // Hash the full content the backend returned (SHA-256 via
    // @warlock.js/fs), not the returned window and not the on-disk file —
    // the mock backend keeps content in memory, and the stale-edit guard
    // later hashes the backend's content too, so it must be the SAME
    // source of truth whatever window or byte cap applied.
    const hash = fs.hash.string(raw);

    const lines = raw.split("\n");
    const totalLines = lines.length;

    const offset = Math.max(1, opts?.offset ?? 1);
    const limit = opts?.limit ?? this.policy.read?.defaultLines ?? DEFAULT_READ_LINES;
    const maxBytes = this.policy.read?.maxBytes;

    const startIndex = offset - 1;
    const window = lines.slice(startIndex, startIndex + Math.max(0, limit));
    const { content, returnedLines, bytesCapped } = numberWindow(
      window,
      offset,
      maxBytes === undefined ? undefined : Math.max(0, Math.floor(maxBytes)),
    );
    const endLine = offset + returnedLines - 1;
    const spillDir = this.spiller.spillDir;
    let spilled: { content: string; truncation: WorkspaceTruncation } | undefined;

    // A read of a spill file is never spilled again; it is already paged.
    if (bytesCapped && spillDir !== undefined && !isInside(absolutePath, spillDir)) {
      const full = numberWindow(window, offset, undefined).content;
      const file = await this.spiller.save("read_file", full);

      if (file !== undefined) {
        spilled = {
          content: `${content}\n[showing lines 1-${returnedLines} of ${window.length}; full output saved to ${file}]`,
          truncation: {
            shown: { lines: returnedLines },
            total: { lines: window.length, bytes: Buffer.byteLength(full, "utf8") },
            path: file,
          },
        };
      }
    }

    return {
      content: spilled?.content ?? content,
      ...(spilled !== undefined ? { truncation: spilled.truncation } : {}),
      ...(spilled?.truncation.path !== undefined ? { spilledTo: [spilled.truncation.path] } : {}),
      startLine: offset,
      endLine,
      totalLines,
      truncated: bytesCapped || endLine < totalLines,
      bytesCapped,
      totalBytes: Buffer.byteLength(raw, "utf8"),
      hash,
    };
  }

  public async writeFile(
    inputPath: string,
    content: string,
  ): Promise<{ hash: string; bytesWritten: number; diagnostics?: string }> {
    const { absolutePath, relativePath } = await resolveInJail(this.policy, inputPath);

    const written = await this.withPathLock(absolutePath, async () => {
      // Ensure the parent directory exists before writing the leaf.
      const parent = path.dirname(absolutePath);
      await this.backend.mkdir(parent);

      await this.backend.writeFile(absolutePath, content);

      return {
        hash: fs.hash.string(content),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    });
    const diagnostics = await this.diagnosticsFor("write_file", [relativePath || inputPath]);

    return { ...written, ...(diagnostics !== undefined ? { diagnostics } : {}) };
  }

  public async editFile(input: EditFileInput): Promise<EditFileResult> {
    const { absolutePath, relativePath } = await resolveInJail(this.policy, input.path);

    const result = await this.withPathLock(absolutePath, () =>
      this.applyEdit(input, absolutePath, relativePath),
    );
    const diagnostics = await this.diagnosticsFor("edit_file", [result.path]);

    return diagnostics === undefined ? result : { ...result, diagnostics };
  }

  /** The read-check-replace-write of {@link editFile}, run under its path lock. */
  private async applyEdit(
    input: EditFileInput,
    absolutePath: string,
    relativePath: string,
  ): Promise<EditFileResult> {
    const current = await this.backend.readFile(absolutePath);
    const currentHash = fs.hash.string(current);

    // Stale-hash guard: if the caller pinned a hash and the file moved
    // underneath them, refuse so they re-read before clobbering.
    if (input.expectHash !== undefined && input.expectHash !== currentHash) {
      throw new WorkspaceEditError(
        `File "${input.path}" changed since it was read; the edit is stale.`,
        {
          type: "stale-hash",
          path: relativePath || input.path,
          expectedHash: input.expectHash,
          actualHash: currentHash,
        },
      );
    }

    const {
      content: updated,
      replacements,
      matchTier,
    } = applyReplacement(
      current,
      input,
      input.path,
      relativePath || input.path,
      this.editOptions(),
    );

    await this.backend.writeFile(absolutePath, updated);

    return {
      path: relativePath || input.path,
      replacements,
      hash: fs.hash.string(updated),
      ...(matchTier !== undefined ? { matchTier } : {}),
    };
  }

  public async multiEdit(input: MultiEditInput): Promise<MultiEditResult> {
    const { absolutePath, relativePath } = await resolveInJail(this.policy, input.path);
    const shownPath = relativePath || input.path;

    if (input.edits.length === 0 || input.edits.length > MAX_MULTI_EDITS) {
      throw new RangeError(
        `A multi-edit needs between 1 and ${MAX_MULTI_EDITS} edits (got ${input.edits.length}).`,
      );
    }

    const result = await this.withPathLock(absolutePath, async () => {
      const current = await this.backend.readFile(absolutePath);
      const currentHash = fs.hash.string(current);

      if (input.expectHash !== undefined && input.expectHash !== currentHash) {
        throw new WorkspaceEditError(
          `File "${input.path}" changed since it was read; none of the edits were applied.`,
          {
            type: "stale-hash",
            path: shownPath,
            expectedHash: input.expectHash,
            actualHash: currentHash,
          },
        );
      }

      // Apply every edit in memory first; one failure leaves the file untouched.
      let content = current;
      let replacements = 0;
      let matchTier: MultiEditResult["matchTier"];
      const options = this.editOptions();

      input.edits.forEach((edit, editIndex) => {
        const applied = applyReplacement(content, edit, input.path, shownPath, options, editIndex);

        content = applied.content;
        replacements += applied.replacements;

        if (applied.matchTier === "whitespace" || matchTier === undefined) {
          matchTier = applied.matchTier ?? matchTier;
        }
      });

      await this.backend.writeFile(absolutePath, content);

      return {
        path: shownPath,
        edits: input.edits.length,
        replacements,
        hash: fs.hash.string(content),
        ...(matchTier !== undefined ? { matchTier } : {}),
      };
    });
    const diagnostics = await this.diagnosticsFor("multi_edit", [shownPath]);

    return diagnostics === undefined ? result : { ...result, diagnostics };
  }

  public async applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
    const result = await this.runPatch(input);

    if (result.dryRun) {
      return result;
    }

    const paths = result.files.filter((file) => file.action !== "deleted").map((file) => file.path);
    const diagnostics = await this.diagnosticsFor("apply_patch", paths);

    return diagnostics === undefined ? result : { ...result, diagnostics };
  }

  private runPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
    return executePatch(input, {
      resolve: (inputPath) => resolveInJail(this.policy, inputPath),
      exists: (absolutePath) => this.backend.exists(absolutePath),
      stat: this.backend.stat
        ? (absolutePath) =>
            (this.backend.stat as NonNullable<WorkspaceBackend["stat"]>)(absolutePath)
        : undefined,
      read: (absolutePath) => this.backend.readFile(absolutePath),
      write: async (absolutePath, content) => {
        await this.backend.mkdir(path.dirname(absolutePath));
        await this.backend.writeFile(absolutePath, content);
      },
      remove: (absolutePath) => this.backend.remove(absolutePath),
      withLock: (key, task) => this.withPathLock(key, task),
      display: (absolutePath) => path.relative(this.policy.cwd, absolutePath),
    });
  }

  /**
   * Check a command line against the shell policy: every command in it
   * (argv or shell mode), then — shell mode — every redirection target and
   * `cd` directory against the jail with symlinks resolved.
   */
  private async assertCommandAllowed(command: string, signal?: AbortSignal): Promise<void> {
    const verdict = checkShellCommand(this.policy, command, {
      remembered: this.approvals,
      resolved: this.resolvedShell,
    });
    const onAsk = this.policy.shell?.onAsk;
    const needsApproval =
      !verdict.allowed && verdict.reason === "approval-required" && verdict.asks.length > 0;

    if (!verdict.allowed && !(needsApproval && onAsk !== undefined)) {
      throw new WorkspacePolicyError(
        verdict.message ?? `Command is not permitted by the workspace shell policy: ${command}`,
        {
          type: "denied-command",
          command,
          ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
          ...(verdict.executable !== undefined ? { executable: verdict.executable } : {}),
          ...(verdict.path !== undefined ? { path: verdict.path } : {}),
        },
      );
    }

    for (const target of verdict.paths) {
      try {
        await resolveInJail(this.policy, target.path);
      } catch (error) {
        if (!(error instanceof WorkspacePolicyError)) {
          throw error;
        }

        throw new WorkspacePolicyError(
          target.access === "cwd"
            ? `\`cd ${target.target}\` resolves (through a symlink) outside the workspace jail or onto a denied path.`
            : `The redirection target \`${target.target}\` resolves (through a symlink) outside the workspace jail or onto a denied path.`,
          { type: "denied-command", reason: "path-escape", command, path: target.target },
        );
      }
    }

    if (this.runtime.jobs.isDisposed) {
      throw new WorkspacePolicyError(
        "The workspace has been disposed; it cannot run new commands.",
        { type: "denied-command", reason: "not-allowed", command },
      );
    }

    if (needsApproval && onAsk !== undefined) {
      await this.askForApproval(command, verdict.asks, onAsk, signal);
    }
  }

  /** Put the commands that need approval to `shell.onAsk`; refuse the line unless it says yes. */
  private async askForApproval(
    command: string,
    asks: WorkspaceShellAsk[],
    onAsk: WorkspaceShellOnAsk,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    let decision: Awaited<ReturnType<WorkspaceShellOnAsk>> | undefined;

    try {
      decision = await onAsk({ command, asks, ...(signal ? { signal } : {}) });
    } catch {
      decision = undefined;
    }

    if (decision?.allow !== true) {
      const reason = refusalReason(decision?.reason);

      throw new WorkspacePolicyError(
        `Running ${asks.map((ask) => `\`${ask.argv.join(" ")}\``).join(", ")} was not approved${reason}`,
        { type: "denied-command", reason: "approval-denied", command },
      );
    }

    if (decision.remember !== undefined) {
      const patterns = Array.isArray(decision.remember) ? decision.remember : [decision.remember];

      for (const pattern of patterns as WorkspaceCommandPattern[]) {
        if (!this.approvals.some((entry) => samePattern(entry, pattern))) {
          this.approvals.push(pattern);
        }
      }
    }
  }

  public async exec(command: string, opts?: ExecOptions): Promise<RunShellResult> {
    await this.assertCommandAllowed(command, opts?.signal);

    const signal = opts?.signal;

    // Refuse an already-cancelled invocation here, so no backend — built-in
    // or custom — ever starts a command whose caller has given up on it.
    if (signal?.aborted) {
      return {
        exitCode: CANCELLED_BEFORE_START_EXIT_CODE,
        stdout: "",
        stderr: "Command was not executed: the invocation was cancelled before it started.",
        truncated: false,
        timedOut: false,
        cancelled: true,
      };
    }

    const shell = this.policy.shell;
    const timeoutMs = opts?.timeoutMs ?? shell?.timeoutMs;
    const maxOutputBytes = shell?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const interpreter = this.resolvedShell.interpreter;

    const env = buildCommandEnv(this.policy);
    const live = ShellOutputStreamer.create(
      this.policy.hooks,
      { command, ...(opts?.callId !== undefined ? { callId: opts.callId } : {}) },
      this.policy.shell?.env,
    );

    let result: WorkspaceBackendExecResult;

    try {
      result = await this.backend.exec(command, {
        cwd: this.policy.cwd,
        timeoutMs,
        env,
        ...(live ? { onOutput: (stream, chunk) => live.push(stream, chunk) } : {}),
        ...(signal ? { signal } : {}),
        ...(interpreter !== "none" ? { interpreter } : {}),
        ...(interpreter !== "none" && this.resolvedShell.file !== undefined
          ? { interpreterPath: this.resolvedShell.file }
          : {}),
      });

      // A backend that cannot stream hands over its capture at the end.
      if (live !== undefined && !live.received) {
        live.push("stdout", result.stdout);
        live.push("stderr", result.stderr);
      }
    } finally {
      live?.end();
    }

    const stdout = await this.fitStream("run_shell-stdout", result.stdout, maxOutputBytes);
    const stderr = await this.fitStream("run_shell-stderr", result.stderr, maxOutputBytes);
    const cancelled = result.cancelled === true;
    const truncation = streamTruncation(stdout.truncation, stderr.truncation);

    return {
      exitCode: result.exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      truncated: stdout.truncated || stderr.truncated,
      timedOut: result.timedOut && !cancelled,
      cancelled,
      ...(truncation !== undefined ? { truncation } : {}),
      ...spilledField(truncation),
    };
  }

  public async startShell(command: string, opts?: StartShellOptions): Promise<ShellJobInfo> {
    const background = this.policy.shell?.background;

    if (background === undefined) {
      throw new WorkspacePolicyError(
        "Background commands are not enabled for this workspace. Run the command without background, or ask for shell.background to be enabled.",
        { type: "denied-command", reason: "not-allowed", command },
      );
    }

    await this.assertCommandAllowed(command);

    const start = this.backend.start?.bind(this.backend);

    if (start === undefined) {
      throw new WorkspacePolicyError("This workspace backend cannot run background commands.", {
        type: "denied-command",
        reason: "not-allowed",
        command,
      });
    }

    const shell = this.policy.shell;
    const interpreter = this.resolvedShell.interpreter;
    const interpreterPath = interpreter !== "none" ? this.resolvedShell.file : undefined;
    const timeoutMs = lowerOf(background.timeoutMs, opts?.timeoutMs);
    const env = buildCommandEnv(this.policy);

    return this.runtime.jobs.start({
      command,
      retainBytes: shell?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      maxJobs: background.maxJobs ?? DEFAULT_MAX_BACKGROUND_JOBS,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      launch: (onOutput, jobId) => {
        const live = ShellOutputStreamer.create(
          this.policy.hooks,
          { command, jobId, ...(opts?.callId !== undefined ? { callId: opts.callId } : {}) },
          this.policy.shell?.env,
        );
        const handle = start(command, {
          cwd: this.policy.cwd,
          env,
          ...(interpreter !== "none" ? { interpreter } : {}),
          ...(interpreterPath !== undefined ? { interpreterPath } : {}),
          onOutput: (stream, chunk) => {
            onOutput(stream, chunk);
            live?.push(stream, chunk);
          },
        });

        void handle.done.then(() => live?.end());

        return handle;
      },
    });
  }

  public async shellOutput(id: string, opts?: ShellOutputOptions): Promise<ShellOutputResult> {
    const result = await this.runtime.jobs.output(id, opts);

    if (!this.spiller.enabled) {
      return result;
    }

    const stdout = await this.spiller.text(`shell_output-${id}-stdout`, result.stdout, "head+tail");
    const stderr = await this.spiller.text(`shell_output-${id}-stderr`, result.stderr, "head+tail");
    const truncation = streamTruncation(stdout.truncation, stderr.truncation);

    return truncation === undefined
      ? result
      : {
          ...result,
          stdout: stdout.value,
          stderr: stderr.value,
          truncated: true,
          truncation,
          ...spilledField(truncation),
        };
  }

  /**
   * Fit one captured stream to the limits: spilled to a file when
   * `output.spillDir` is set, otherwise clipped at `maxBytes` as always.
   */
  private async fitStream(
    label: string,
    value: string,
    maxBytes: number,
  ): Promise<{ value: string; truncated: boolean; truncation?: WorkspaceTruncation }> {
    if (this.spiller.enabled) {
      const cap = this.policy.shell?.maxOutputBytes;
      const spilled = await this.spiller.text(label, value, "head+tail", cap);

      if (spilled.truncation !== undefined) {
        return { value: spilled.value, truncated: true, truncation: spilled.truncation };
      }
    }

    const capped = capOutput(value, maxBytes);

    if (!capped.truncated) {
      return capped;
    }

    return {
      ...capped,
      truncation: {
        shown: { lines: splitLines(capped.value).length },
        total: { lines: splitLines(value).length, bytes: Buffer.byteLength(value, "utf8") },
      },
    };
  }

  public shellKill(id: string): Promise<ShellJobInfo> {
    return this.runtime.jobs.kill(id);
  }

  public listShells(): ShellJobInfo[] {
    return this.runtime.jobs.list();
  }

  public async dispose(): Promise<void> {
    await this.runtime.jobs.dispose();
    await this.spiller.dispose();
  }

  public async listDir(inputPath = ".", opts?: ListDirOptions): Promise<ListDirResult> {
    const { absolutePath: root, relativePath: rootRelative } = await resolveInJail(
      this.policy,
      inputPath,
    );
    const { absolutePath: jailRoot } = await resolveInJail(this.policy, ".");
    const listPolicy = this.policy.list;
    const maxDepth = Math.max(1, Math.floor(listPolicy?.maxDepth ?? DEFAULT_LIST_MAX_DEPTH));
    const depth = Math.min(Math.max(1, Math.floor(opts?.depth ?? 1)), maxDepth);
    const maxEntries = Math.max(1, Math.floor(listPolicy?.maxEntries ?? DEFAULT_LIST_MAX_ENTRIES));
    const ignore = [...(listPolicy?.ignore ?? DEFAULT_LIST_IGNORE), ...(opts?.ignore ?? [])];
    const insideCwd = isInside(root, jailRoot);

    if (!(await this.isDirectory(root))) {
      throw new Error(`"${inputPath}" is not a directory in the workspace.`);
    }

    const entries: ListDirEntry[] = [];
    let level: string[] = [root];
    let truncated = false;

    for (let currentDepth = 1; currentDepth <= depth && level.length > 0; currentDepth++) {
      const nextLevel: string[] = [];

      for (const directory of level) {
        let children: string[];

        try {
          children = await this.backend.list(directory);
        } catch {
          continue;
        }

        children.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

        for (const child of children) {
          const relativeToJail = insideCwd
            ? path.relative(jailRoot, child).split(path.sep).join("/")
            : child;

          if (
            insideCwd &&
            (this.isDenied(relativeToJail) || matchesAnyGlob(relativeToJail, ignore))
          ) {
            continue;
          }

          const relativeToRoot = path.relative(root, child).split(path.sep).join("/");

          if (!insideCwd && matchesAnyGlob(relativeToRoot, ignore)) {
            continue;
          }

          if (entries.length >= maxEntries) {
            truncated = true;

            break;
          }

          const described = await this.describe(child);

          entries.push({
            path: relativeToJail,
            type: described.type,
            ...(described.size !== undefined ? { size: described.size } : {}),
            depth: currentDepth,
          });

          if (described.type === "directory") {
            nextLevel.push(child);
          }
        }

        if (truncated) {
          break;
        }
      }

      if (truncated) {
        break;
      }

      level = nextLevel;
    }

    return { path: insideCwd ? rootRelative || "." : root, entries, truncated };
  }

  /** Kind and size of a listed entry; symlinks are reported, never followed. */
  private async describe(absPath: string): Promise<{ type: ListDirEntryType; size?: number }> {
    if (this.backend.stat) {
      try {
        const stats = await this.backend.stat(absPath);

        return stats.type === "file" ? { type: "file", size: stats.size } : { type: stats.type };
      } catch {
        return { type: "other" };
      }
    }

    // No `stat`: a child is a directory iff it can be listed, and it must
    // still resolve inside the jail before it is descended into.
    if (await this.isDirectory(absPath)) {
      try {
        await resolveInJail(this.policy, absPath);

        return { type: "directory" };
      } catch {
        return { type: "other" };
      }
    }

    return { type: "file" };
  }

  public async grep(
    pattern: string,
    opts?: { glob?: string; ignoreCase?: boolean; signal?: AbortSignal },
  ): Promise<GrepResult> {
    if (!isSafeGrepPattern(pattern)) {
      throw new WorkspacePolicyError(
        `Grep pattern is too long or too likely to cause catastrophic regex backtracking: ${pattern}`,
        { type: "unsafe-pattern", pattern },
      );
    }

    const { absolutePath: jailRoot } = await resolveInJail(this.policy, ".");
    const flags = opts?.ignoreCase ? "i" : "";
    const regex = new RegExp(pattern, flags);
    const globRegex = opts?.glob ? globToRegExp(opts.glob) : undefined;

    const walked = await this.searchFiles(jailRoot, opts?.glob, opts?.signal);
    const files = walked.files.sort();
    const matches: GrepMatch[] = [];

    for (const absFile of files) {
      opts?.signal?.throwIfAborted();

      const relativePath = path.relative(jailRoot, absFile).split(path.sep).join("/");

      if (globRegex && !globRegex.test(relativePath)) {
        continue;
      }

      // Skip files the deny list would block (e.g. `.git/**`).
      if (this.isDenied(relativePath)) {
        continue;
      }

      let content: string;

      try {
        content = await this.backend.readFile(absFile);
      } catch {
        // Unreadable entry (vanished, binary handle) — skip, don't fail.
        continue;
      }

      const lines = content.split("\n");

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? "";

        // Cap the input size a single `RegExp#test` call scans: backtracking
        // cost is exponential in input length, so this bounds the worst-case
        // time even a pathological (but length/shape-allowed) pattern can
        // burn on any one line.
        if (line.length > MAX_GREP_LINE_SCAN_LENGTH) {
          continue;
        }

        if (regex.test(line)) {
          matches.push({ path: relativePath, line: index + 1, text: line });

          if (matches.length >= DEFAULT_MAX_GREP_MATCHES) {
            return this.fitMatches(matches, walked.truncated);
          }
        }
      }
    }

    return this.fitMatches(matches, walked.truncated);
  }

  /** Apply the `output` limits to a finished match list. */
  private async fitMatches(matches: GrepMatch[], maxFilesReached: boolean): Promise<GrepResult> {
    const result = await this.fitMatchesWithin(matches);

    return maxFilesReached ? { ...result, truncated: true, maxFilesReached: true } : result;
  }

  private async fitMatchesWithin(matches: GrepMatch[]): Promise<GrepResult> {
    const fitted = await this.spiller.list(
      "grep",
      matches,
      (match) => `${match.path}:${match.line}:${match.text}`,
      "head",
    );

    return fitted.truncation === undefined
      ? { matches, total: matches.length }
      : {
          matches: fitted.items,
          total: matches.length,
          truncated: true,
          truncation: fitted.truncation,
          ...spilledField({ stdout: fitted.truncation }),
        };
  }

  public async globResult(pattern: string, opts?: { signal?: AbortSignal }): Promise<GlobResult> {
    const { paths: all, maxFilesReached } = await this.globWalk(pattern, opts?.signal);
    const fitted = await this.spiller.list("glob", all, (entry) => entry, "head");
    const reached = maxFilesReached ? { truncated: true, maxFilesReached: true } : {};

    return fitted.truncation === undefined
      ? { paths: all, ...reached }
      : {
          paths: fitted.items,
          truncated: true,
          truncation: fitted.truncation,
          ...spilledField({ stdout: fitted.truncation }),
          ...reached,
        };
  }

  public async glob(pattern: string, opts?: { signal?: AbortSignal }): Promise<string[]> {
    return (await this.globWalk(pattern, opts?.signal)).paths;
  }

  /** Match `pattern` against the walked files; sorted, with whether the walk hit `maxFiles`. */
  private async globWalk(
    pattern: string,
    signal: AbortSignal | undefined,
  ): Promise<{ paths: string[]; maxFilesReached: boolean }> {
    const { absolutePath: jailRoot } = await resolveInJail(this.policy, ".");
    const regex = globToRegExp(pattern);
    const walked = await this.searchFiles(jailRoot, pattern, signal);
    const matched: string[] = [];

    for (const absFile of walked.files) {
      const relativePath = path.relative(jailRoot, absFile).split(path.sep).join("/");

      if (this.isDenied(relativePath)) {
        continue;
      }

      if (regex.test(relativePath)) {
        matched.push(relativePath);
      }
    }

    return { paths: matched.sort(), maxFilesReached: walked.truncated };
  }

  public async exists(inputPath: string): Promise<boolean> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath);

    return this.backend.exists(absolutePath);
  }

  public async mkdir(inputPath: string): Promise<void> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath);

    await this.backend.mkdir(absolutePath);
  }

  public async remove(inputPath: string): Promise<void> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath);

    await this.withPathLock(absolutePath, () => this.backend.remove(absolutePath));
  }

  /** Whether a `/`-separated relative path hits the policy deny list. */
  private isDenied(relativePath: string): boolean {
    const denyPaths = this.policy.denyPaths;

    return (
      denyPaths !== undefined && denyPaths.length > 0 && matchesAnyGlob(relativePath, denyPaths)
    );
  }
}

/** `{ spilledTo }` for every spill file named in the truncation metadata, or nothing. */
function spilledField(
  truncation: { stdout?: WorkspaceTruncation; stderr?: WorkspaceTruncation } | undefined,
): { spilledTo?: string[] } {
  const paths = [truncation?.stdout?.path, truncation?.stderr?.path].filter(
    (file): file is string => file !== undefined,
  );

  return paths.length > 0 ? { spilledTo: paths } : {};
}

/** Combine per-stream truncation metadata; `undefined` when neither stream was clipped. */
function streamTruncation(
  stdout: WorkspaceTruncation | undefined,
  stderr: WorkspaceTruncation | undefined,
): { stdout?: WorkspaceTruncation; stderr?: WorkspaceTruncation } | undefined {
  if (stdout === undefined && stderr === undefined) {
    return undefined;
  }

  return {
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
  };
}

/** The lower of two optional limits (either may be absent). */
function lowerOf(
  policyLimit: number | undefined,
  requested: number | undefined,
): number | undefined {
  if (requested === undefined || requested <= 0) {
    return policyLimit;
  }

  return policyLimit === undefined ? requested : Math.min(policyLimit, requested);
}

/**
 * Create the policy-enforced operation layer over a backend.
 *
 * The returned {@link WorkspaceOps} is the single seam both the
 * agent-facing `.tools.*` factories and the human-facing direct methods
 * delegate to — one jail, one command-gate, one read-before-edit guard,
 * regardless of caller. Path inputs are workspace-relative and resolved
 * against `policy.cwd`; escapes and denied commands surface as typed
 * {@link WorkspacePolicyError} / {@link WorkspaceEditError}.
 *
 * @param backend - The dumb IO executor (local disk or in-memory mock).
 * @param policy - The policy that bounds every operation.
 * @param runtime - State shared with other views of the same workspace
 *   (its background commands); a fresh one when omitted.
 *
 * @example
 * const ops = createOps(localBackend, { cwd: "/srv/api", shell: { allow: ["npm"] } });
 * const { content, hash } = await ops.readFile("src/index.ts");
 */
export function createOps(
  backend: WorkspaceBackend,
  policy: WorkspacePolicy,
  runtime?: OpsRuntime,
): WorkspaceOps {
  return new Ops(backend, policy, runtime ?? { jobs: new ShellJobs() });
}
