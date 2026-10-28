import path from "node:path";
import { fs } from "@warlock.js/fs";
import { WorkspaceEditError, WorkspacePolicyError } from "./errors";
import { globToRegExp, isInside, matchesAnyGlob } from "./policy/jail";
import { buildCommandEnv, resolveInJail } from "./policy/policy";
import { checkShellCommand } from "./policy/shell-check";
import { DEFAULT_MAX_BACKGROUND_JOBS, ShellJobs } from "./shell-jobs";
import { applyHunks } from "./patch/apply-hunks";
import { parsePatch } from "./patch/parse-patch";
import type {
  ApplyPatchFileResult,
  ApplyPatchInput,
  ApplyPatchResult,
  EditFileInput,
  EditFileResult,
  ExecOptions,
  GrepMatch,
  GrepResult,
  ListDirEntry,
  ListDirEntryType,
  ListDirOptions,
  ListDirResult,
  MultiEditInput,
  MultiEditOperation,
  MultiEditResult,
  ReadFileResult,
  RunShellResult,
  ShellJobInfo,
  ShellOutputOptions,
  ShellOutputResult,
  StartShellOptions,
  WorkspaceBackend,
  WorkspaceOps,
  WorkspacePolicy,
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
/** Largest file, in UTF-8 bytes, `applyPatch` will read and rewrite. */
const MAX_PATCH_FILE_BYTES = 10 * 1024 * 1024;
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

  public constructor(
    private readonly backend: WorkspaceBackend,
    private readonly policy: WorkspacePolicy,
    private readonly runtime: OpsRuntime,
  ) {}

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
   * Recursively collect every file under `absDir` as absolute paths,
   * via the backend's `list` (so it works over disk or the in-memory
   * mock). Directories are descended; files are accumulated.
   */
  private async walkFiles(absDir: string): Promise<string[]> {
    const found: string[] = [];
    const entries = await this.backend.list(absDir);

    await Promise.all(
      entries.map(async (entry) => {
        // A child is a directory iff listing it succeeds; the backend
        // throws/returns for a file. Probe via `exists` + a list guard.
        const isDir = await this.isDirectory(entry);

        if (isDir) {
          const nested = await this.walkFiles(entry);
          found.push(...nested);
        } else {
          found.push(entry);
        }
      }),
    );

    return found;
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
    const { absolutePath } = await resolveInJail(this.policy, inputPath);
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

    return {
      content,
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
  ): Promise<{ hash: string; bytesWritten: number }> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath);

    return this.withPathLock(absolutePath, async () => {
      // Ensure the parent directory exists before writing the leaf.
      const parent = path.dirname(absolutePath);
      await this.backend.mkdir(parent);

      await this.backend.writeFile(absolutePath, content);

      return {
        hash: fs.hash.string(content),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    });
  }

  public async editFile(input: EditFileInput): Promise<EditFileResult> {
    const { absolutePath, relativePath } = await resolveInJail(this.policy, input.path);

    return this.withPathLock(absolutePath, () => this.applyEdit(input, absolutePath, relativePath));
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

    const { content: updated, replacements } = applyReplacement(
      current,
      input,
      input.path,
      relativePath || input.path,
    );

    await this.backend.writeFile(absolutePath, updated);

    return {
      path: relativePath || input.path,
      replacements,
      hash: fs.hash.string(updated),
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

    return this.withPathLock(absolutePath, async () => {
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

      input.edits.forEach((edit, editIndex) => {
        const applied = applyReplacement(content, edit, input.path, shownPath, editIndex);

        content = applied.content;
        replacements += applied.replacements;
      });

      await this.backend.writeFile(absolutePath, content);

      return {
        path: shownPath,
        edits: input.edits.length,
        replacements,
        hash: fs.hash.string(content),
      };
    });
  }

  public async applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
    const filePatches = parsePatch(input.patch);

    // Resolve every path through the jail first (symlinks, `..`, deny globs).
    const targets = await Promise.all(
      filePatches.map(async (filePatch) => ({
        filePatch,
        from:
          filePatch.oldPath === null ? null : await resolveInJail(this.policy, filePatch.oldPath),
        to: filePatch.newPath === null ? null : await resolveInJail(this.policy, filePatch.newPath),
      })),
    );

    const lockPaths = [
      ...new Set(
        targets.flatMap((target) =>
          [target.from?.absolutePath, target.to?.absolutePath].filter(
            (value): value is string => value !== undefined,
          ),
        ),
      ),
    ].sort();

    const run = async (): Promise<ApplyPatchResult> => {
      // Virtual tree: absolute path -> content (null = removed). Later file
      // patches see the result of earlier ones.
      const staged = new Map<string, string | null>();
      const original = new Map<string, string | null>();
      const results: ApplyPatchFileResult[] = [];

      const load = async (absolutePath: string, shown: string): Promise<string | null> => {
        if (staged.has(absolutePath)) {
          return staged.get(absolutePath) ?? null;
        }

        if (!(await this.backend.exists(absolutePath))) {
          original.set(absolutePath, null);

          return null;
        }

        const stat = this.backend.stat ? await this.backend.stat(absolutePath) : undefined;

        if (stat !== undefined && stat.type !== "file") {
          throw new WorkspaceEditError(`"${shown}" is not a regular file; it cannot be patched.`, {
            type: "file-missing",
            path: shown,
          });
        }

        if (stat !== undefined && stat.size > MAX_PATCH_FILE_BYTES) {
          throw new WorkspaceEditError(
            `"${shown}" is larger than ${MAX_PATCH_FILE_BYTES} bytes; it cannot be patched.`,
            { type: "patch-invalid", path: shown },
          );
        }

        const content = await this.backend.readFile(absolutePath);

        if (content.includes("\0")) {
          throw new WorkspaceEditError(
            `"${shown}" is a binary file; binary files cannot be patched.`,
            {
              type: "binary-file",
              path: shown,
            },
          );
        }

        original.set(absolutePath, content);

        return content;
      };

      for (const { filePatch, from, to } of targets) {
        const shownFrom = from?.relativePath || filePatch.oldPath || "";
        const shownTo = to?.relativePath || filePatch.newPath || "";

        if (filePatch.kind === "create") {
          const absolutePath = (to as NonNullable<typeof to>).absolutePath;

          if ((await load(absolutePath, shownTo)) !== null) {
            throw new WorkspaceEditError(
              `"${shownTo}" already exists; the patch cannot create it.`,
              {
                type: "file-exists",
                path: shownTo,
              },
            );
          }

          const content = applyHunks("", filePatch.hunks, shownTo);

          staged.set(absolutePath, content);
          results.push({
            path: shownTo,
            action: "created",
            hunks: filePatch.hunks.length,
            hash: fs.hash.string(content),
          });

          continue;
        }

        const source = (from as NonNullable<typeof from>).absolutePath;
        const current = await load(source, shownFrom);

        if (current === null) {
          throw new WorkspaceEditError(
            `"${shownFrom}" does not exist; the patch cannot change it.`,
            {
              type: "file-missing",
              path: shownFrom,
            },
          );
        }

        const updated = applyHunks(current, filePatch.hunks, shownFrom);

        if (filePatch.kind === "delete") {
          if (updated !== "") {
            throw new WorkspaceEditError(
              `The patch deletes "${shownFrom}" but its hunks do not remove all of the file's content.`,
              {
                type: "hunk-failed",
                path: shownFrom,
                hunkIndex: Math.max(filePatch.hunks.length - 1, 0),
              },
            );
          }

          staged.set(source, null);
          results.push({ path: shownFrom, action: "deleted", hunks: filePatch.hunks.length });

          continue;
        }

        if (filePatch.kind === "rename") {
          const destination = (to as NonNullable<typeof to>).absolutePath;

          if (destination !== source && (await load(destination, shownTo)) !== null) {
            throw new WorkspaceEditError(
              `"${shownTo}" already exists; the patch cannot rename "${shownFrom}" onto it.`,
              { type: "file-exists", path: shownTo },
            );
          }

          staged.set(source, null);
          staged.set(destination, updated);
          results.push({
            path: shownTo,
            action: "renamed",
            oldPath: shownFrom,
            hunks: filePatch.hunks.length,
            hash: fs.hash.string(updated),
          });

          continue;
        }

        staged.set(source, updated);
        results.push({
          path: shownFrom,
          action: "modified",
          hunks: filePatch.hunks.length,
          hash: fs.hash.string(updated),
        });
      }

      if (input.dryRun === true) {
        return { files: results, dryRun: true };
      }

      // Commit. Anything that fails part-way is rolled back to the original state.
      const touched: string[] = [];

      try {
        for (const [absolutePath, content] of staged) {
          if (content !== null && content !== (original.get(absolutePath) ?? null)) {
            await this.backend.mkdir(path.dirname(absolutePath));
            await this.backend.writeFile(absolutePath, content);
            touched.push(absolutePath);
          }
        }

        for (const [absolutePath, content] of staged) {
          if (
            content === null &&
            original.get(absolutePath) !== null &&
            original.has(absolutePath)
          ) {
            await this.backend.remove(absolutePath);
            touched.push(absolutePath);
          }
        }
      } catch (error) {
        const failures: string[] = [];

        for (const absolutePath of touched.reverse()) {
          try {
            const before = original.get(absolutePath) ?? null;

            if (before === null) {
              if (await this.backend.exists(absolutePath)) {
                await this.backend.remove(absolutePath);
              }
            } else {
              await this.backend.writeFile(absolutePath, before);
            }
          } catch {
            failures.push(path.relative(this.policy.cwd, absolutePath));
          }
        }

        const reason = error instanceof Error ? error.message : String(error);

        throw new WorkspaceEditError(
          `Writing the patch failed (${reason}); ${failures.length === 0 ? "every change was rolled back" : `could not restore: ${failures.join(", ")}`}.`,
          { type: "patch-invalid", path: "" },
        );
      }

      return { files: results, dryRun: false };
    };

    // Hold every touched path's lock (sorted, so concurrent patches cannot deadlock).
    const locked = lockPaths.reduceRight<() => Promise<ApplyPatchResult>>(
      (inner, lockPath) => () => this.withPathLock(lockPath, inner),
      run,
    );

    return locked();
  }

  /**
   * Check a command line against the shell policy: every command in it
   * (argv or shell mode), then — shell mode — every redirection target and
   * `cd` directory against the jail with symlinks resolved.
   */
  private async assertCommandAllowed(command: string): Promise<void> {
    const verdict = checkShellCommand(this.policy, command);

    if (!verdict.allowed) {
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
  }

  public async exec(command: string, opts?: ExecOptions): Promise<RunShellResult> {
    await this.assertCommandAllowed(command);

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
    const interpreter = shell?.interpreter ?? "none";

    const result = await this.backend.exec(command, {
      cwd: this.policy.cwd,
      timeoutMs,
      env: buildCommandEnv(this.policy),
      ...(signal ? { signal } : {}),
      ...(interpreter !== "none" ? { interpreter } : {}),
    });

    const stdout = capOutput(result.stdout, maxOutputBytes);
    const stderr = capOutput(result.stderr, maxOutputBytes);
    const cancelled = result.cancelled === true;

    return {
      exitCode: result.exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      truncated: stdout.truncated || stderr.truncated,
      timedOut: result.timedOut && !cancelled,
      cancelled,
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
    const interpreter = shell?.interpreter ?? "none";
    const timeoutMs = lowerOf(background.timeoutMs, opts?.timeoutMs);
    const env = buildCommandEnv(this.policy);

    return this.runtime.jobs.start({
      command,
      retainBytes: shell?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      maxJobs: background.maxJobs ?? DEFAULT_MAX_BACKGROUND_JOBS,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      launch: (onOutput) =>
        start(command, {
          cwd: this.policy.cwd,
          env,
          ...(interpreter !== "none" ? { interpreter } : {}),
          onOutput,
        }),
    });
  }

  public shellOutput(id: string, opts?: ShellOutputOptions): Promise<ShellOutputResult> {
    return this.runtime.jobs.output(id, opts);
  }

  public shellKill(id: string): Promise<ShellJobInfo> {
    return this.runtime.jobs.kill(id);
  }

  public listShells(): ShellJobInfo[] {
    return this.runtime.jobs.list();
  }

  public dispose(): Promise<void> {
    return this.runtime.jobs.dispose();
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
    opts?: { glob?: string; ignoreCase?: boolean },
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

    const files = await this.walkFiles(jailRoot);
    const matches: GrepMatch[] = [];

    for (const absFile of files) {
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
            return { matches, total: matches.length };
          }
        }
      }
    }

    return { matches, total: matches.length };
  }

  public async glob(pattern: string): Promise<string[]> {
    const { absolutePath: jailRoot } = await resolveInJail(this.policy, ".");
    const regex = globToRegExp(pattern);

    const files = await this.walkFiles(jailRoot);
    const matched: string[] = [];

    for (const absFile of files) {
      const relativePath = path.relative(jailRoot, absFile).split(path.sep).join("/");

      if (this.isDenied(relativePath)) {
        continue;
      }

      if (regex.test(relativePath)) {
        matched.push(relativePath);
      }
    }

    return matched.sort();
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
 * Apply one exact-string replacement to `content` under the edit rules:
 * `oldString` must occur, and exactly once unless `replaceAll`.
 */
function applyReplacement(
  content: string,
  edit: MultiEditOperation,
  inputPath: string,
  shownPath: string,
  editIndex?: number,
): { content: string; replacements: number } {
  const occurrences = countOccurrences(content, edit.oldString);
  const which = editIndex === undefined ? "" : `Edit ${editIndex + 1}: `;
  const nothingApplied = editIndex === undefined ? "" : " None of the edits were applied.";
  const indexOption = editIndex === undefined ? {} : { editIndex };

  if (occurrences === 0) {
    throw new WorkspaceEditError(
      `${which}The text to replace was not found in "${inputPath}".${nothingApplied}`,
      { type: "not-found", path: shownPath, matches: 0, ...indexOption },
    );
  }

  if (occurrences > 1 && !edit.replaceAll) {
    throw new WorkspaceEditError(
      `${which}The text to replace is not unique in "${inputPath}" (${occurrences} matches); ` +
        `pass replaceAll or include more surrounding context.${nothingApplied}`,
      { type: "not-unique", path: shownPath, matches: occurrences, ...indexOption },
    );
  }

  return {
    content: edit.replaceAll
      ? content.split(edit.oldString).join(edit.newString)
      : replaceFirst(content, edit.oldString, edit.newString),
    replacements: edit.replaceAll ? occurrences : 1,
  };
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }

  let count = 0;
  let from = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const index = haystack.indexOf(needle, from);

    if (index === -1) {
      break;
    }

    count++;
    from = index + needle.length;
  }

  return count;
}

/** Replace the first occurrence of `needle` with `replacement`. */
function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const index = haystack.indexOf(needle);

  if (index === -1) {
    return haystack;
  }

  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
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
