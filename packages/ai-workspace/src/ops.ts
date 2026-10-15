import path from "node:path";
import { fs } from "@warlock.js/fs";
import { WorkspaceEditError, WorkspacePolicyError } from "./errors";
import { buildEnv, isCommandAllowed, resolveInJail } from "./policy/policy";
import type {
  EditFileInput,
  EditFileResult,
  GrepMatch,
  GrepResult,
  RunShellResult,
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

/**
 * Number the lines of `content` `cat -n` style: a right-aligned line
 * number (min width 6), a tab, then the line. `startLine` is the 1-based
 * number of the first line in the window.
 */
function numberLines(content: string, startLine: number): string {
  const lines = content.split("\n");

  return lines
    .map((line, index) => {
      const lineNumber = startLine + index;

      return `${String(lineNumber).padStart(6, " ")}\t${line}`;
    })
    .join("\n");
}

/**
 * Clip a captured stream at `maxBytes` (measured in UTF-8 bytes).
 * Returns the possibly-clipped string plus whether clipping occurred.
 */
function capOutput(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return { value, truncated: false };
  }

  // Slice on a byte boundary; `toString` tolerates a split multi-byte
  // char at the tail by emitting the replacement character, which is
  // acceptable for a truncated diagnostic stream.
  return { value: bytes.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

/**
 * Minimal glob match over a `/`-separated relative path. Supports `**`
 * (spans separators), `*` (within a segment), and `?` (one non-separator
 * char) — enough for the workspace's `glob`/grep narrowing without
 * pulling in a runtime dependency.
 */
function globToRegExp(glob: string): RegExp {
  let source = "";

  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];

    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index++;

        if (glob[index + 1] === "/") {
          index++;
        }
      } else {
        source += "[^/]*";
      }

      continue;
    }

    if (char === "?") {
      source += "[^/]";

      continue;
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp(`^${source}$`);
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
class Ops implements WorkspaceOps {
  public constructor(
    private readonly backend: WorkspaceBackend,
    private readonly policy: WorkspacePolicy,
  ) {}

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
  ): Promise<{ content: string; hash: string; totalLines: number }> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath);
    const raw = await this.backend.readFile(absolutePath);

    // Hash the content the backend returned (SHA-256 via @warlock.js/fs),
    // not the on-disk file — the mock backend keeps content in memory,
    // and hashing the returned bytes is what the stale-edit guard later
    // compares against, so it must be the SAME source of truth.
    const hash = fs.hash.string(raw);

    const lines = raw.split("\n");
    const totalLines = lines.length;

    const offset = Math.max(1, opts?.offset ?? 1);
    const limit = opts?.limit ?? this.policy.read?.defaultLines ?? DEFAULT_READ_LINES;

    const startIndex = offset - 1;
    const window = lines.slice(startIndex, startIndex + limit);
    const content = numberLines(window.join("\n"), offset);

    return { content, hash, totalLines };
  }

  public async writeFile(
    inputPath: string,
    content: string,
  ): Promise<{ hash: string; bytesWritten: number }> {
    const { absolutePath } = await resolveInJail(this.policy, inputPath);

    // Ensure the parent directory exists before writing the leaf.
    const parent = path.dirname(absolutePath);
    await this.backend.mkdir(parent);

    await this.backend.writeFile(absolutePath, content);

    return {
      hash: fs.hash.string(content),
      bytesWritten: Buffer.byteLength(content, "utf8"),
    };
  }

  public async editFile(input: EditFileInput): Promise<EditFileResult> {
    const { absolutePath, relativePath } = await resolveInJail(this.policy, input.path);
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

    const occurrences = countOccurrences(current, input.oldString);

    if (occurrences === 0) {
      throw new WorkspaceEditError(
        `The text to replace was not found in "${input.path}".`,
        { type: "not-found", path: relativePath || input.path, matches: 0 },
      );
    }

    if (occurrences > 1 && !input.replaceAll) {
      throw new WorkspaceEditError(
        `The text to replace is not unique in "${input.path}" (${occurrences} matches); ` +
          `pass replaceAll or include more surrounding context.`,
        { type: "not-unique", path: relativePath || input.path, matches: occurrences },
      );
    }

    const updated = input.replaceAll
      ? current.split(input.oldString).join(input.newString)
      : replaceFirst(current, input.oldString, input.newString);

    await this.backend.writeFile(absolutePath, updated);

    return {
      path: relativePath || input.path,
      replacements: input.replaceAll ? occurrences : 1,
      hash: fs.hash.string(updated),
    };
  }

  public async exec(
    command: string,
    opts?: { timeoutMs?: number },
  ): Promise<RunShellResult> {
    if (!isCommandAllowed(this.policy, command)) {
      throw new WorkspacePolicyError(
        `Command is not permitted by the workspace shell policy: ${command}`,
        { type: "denied-command", command },
      );
    }

    const shell = this.policy.shell;
    const timeoutMs = opts?.timeoutMs ?? shell?.timeoutMs;
    const maxOutputBytes = shell?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    const result = await this.backend.exec(command, {
      cwd: this.policy.cwd,
      timeoutMs,
      env: buildEnv(this.policy),
    });

    const stdout = capOutput(result.stdout, maxOutputBytes);
    const stderr = capOutput(result.stderr, maxOutputBytes);

    return {
      exitCode: result.exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      truncated: stdout.truncated || stderr.truncated,
      timedOut: result.timedOut,
    };
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
        const line = lines[index];

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

    await this.backend.remove(absolutePath);
  }

  /** Whether a `/`-separated relative path hits the policy deny list. */
  private isDenied(relativePath: string): boolean {
    const denyPaths = this.policy.denyPaths;

    if (!denyPaths || denyPaths.length === 0) {
      return false;
    }

    return denyPaths.some((glob) => {
      if (globToRegExp(glob).test(relativePath)) {
        return true;
      }

      if (!glob.includes("*") && !glob.includes("?")) {
        const prefix = glob.endsWith("/") ? glob : `${glob}/`;

        return relativePath.startsWith(prefix);
      }

      return false;
    });
  }
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
 *
 * @example
 * const ops = createOps(localBackend, { cwd: "/srv/api", shell: { allow: ["npm"] } });
 * const { content, hash } = await ops.readFile("src/index.ts");
 */
export function createOps(
  backend: WorkspaceBackend,
  policy: WorkspacePolicy,
): WorkspaceOps {
  return new Ops(backend, policy);
}
