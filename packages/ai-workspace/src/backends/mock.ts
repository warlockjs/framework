import type {
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
} from "../contracts/workspace-backend.contract";

/**
 * A scripted outcome for the mock backend's `exec`. Mirrors
 * {@link WorkspaceBackendExecResult} but every field is optional so a
 * registration can specify only what it cares about — the rest fall back
 * to a successful, empty-output, non-timed-out run.
 */
export type MockExecResult = Partial<WorkspaceBackendExecResult>;

/**
 * The two seedable inputs of a mock backend:
 *
 * - `files` — initial file tree as `absolutePath -> content`. Parent
 *   directories of each seeded file are implicitly created.
 * - `commands` — scripted `exec` outcomes keyed on the **exact** command
 *   line. Any command not registered here resolves to a `0`-exit no-op.
 */
export interface MockBackendSeed {
  /** Initial file contents, keyed by absolute path. */
  files?: Record<string, string>;
  /** Scripted `exec` results, keyed by exact command line. */
  commands?: Record<string, MockExecResult>;
}

/**
 * Normalize an absolute path to a stable in-memory key: forward slashes,
 * collapsed duplicate separators, and resolved `.` / `..` segments. There
 * are no symlinks in memory, so this is a pure lexical canonicalization —
 * exactly what the backend's `realpath` promises.
 */
function canonicalize(absPath: string): string {
  const unified = absPath.replace(/\\/g, "/");
  // Preserve a leading slash (POSIX root) or a `C:`-style Windows drive
  // prefix; everything else is a normal segment.
  const driveMatch = unified.match(/^([a-zA-Z]:)?\/?/);
  const prefix = driveMatch ? driveMatch[0] : "";
  const rest = unified.slice(prefix.length);

  const resolved: string[] = [];

  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      resolved.pop();

      continue;
    }

    resolved.push(segment);
  }

  const joined = resolved.join("/");

  // A trailing slash on the prefix means it was absolute; keep it so the
  // result stays absolute even when the body is empty (the root itself).
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  return joined.length > 0 ? `${normalizedPrefix}${joined}` : normalizedPrefix;
}

/** All ancestor directory keys of a canonical path, root-first. */
function ancestorsOf(canonicalPath: string): string[] {
  const lastSlash = canonicalPath.lastIndexOf("/");

  if (lastSlash <= 0) {
    return [];
  }

  const parent = canonicalPath.slice(0, lastSlash);
  const result = ancestorsOf(parent);

  result.push(parent);

  return result;
}

/**
 * The in-memory executor behind {@link createMockBackend}. Holds the file
 * tree in a `Map`, the directory set in a `Set`, and the scripted command
 * table in a second `Map` — no disk, no child processes, fully
 * deterministic. Construct it via the factory, never directly.
 */
class MockBackend implements WorkspaceBackend {
  /** Canonical file path -> content. */
  private readonly files = new Map<string, string>();

  /** Canonical directory paths that exist (including implicit parents). */
  private readonly directories = new Set<string>();

  /** Exact command line -> scripted outcome. */
  private readonly commands = new Map<string, MockExecResult>();

  public constructor(seed?: MockBackendSeed) {
    for (const [path, content] of Object.entries(seed?.files ?? {})) {
      const canonical = canonicalize(path);

      this.files.set(canonical, content);
      this.registerAncestorDirectories(canonical);
    }

    for (const [command, result] of Object.entries(seed?.commands ?? {})) {
      this.commands.set(command, result);
    }
  }

  /** Record every ancestor directory of a path as existing. */
  private registerAncestorDirectories(canonicalPath: string): void {
    for (const ancestor of ancestorsOf(canonicalPath)) {
      this.directories.add(ancestor);
    }
  }

  public async readFile(absPath: string): Promise<string> {
    const canonical = canonicalize(absPath);
    const content = this.files.get(canonical);

    if (content === undefined) {
      throw new Error(`Mock backend: no such file: ${canonical}`);
    }

    return content;
  }

  public async writeFile(absPath: string, content: string): Promise<void> {
    const canonical = canonicalize(absPath);

    this.files.set(canonical, content);
    this.registerAncestorDirectories(canonical);
  }

  public async exists(absPath: string): Promise<boolean> {
    const canonical = canonicalize(absPath);

    return this.files.has(canonical) || this.directories.has(canonical);
  }

  public async mkdir(absPath: string): Promise<void> {
    const canonical = canonicalize(absPath);

    this.directories.add(canonical);
    this.registerAncestorDirectories(canonical);
  }

  public async remove(absPath: string): Promise<void> {
    const canonical = canonicalize(absPath);
    const prefix = `${canonical}/`;

    // Drop the entry itself and any descendant files/directories — a
    // recursive tree removal, matching the contract's "file or directory
    // tree" wording.
    for (const file of [...this.files.keys()]) {
      if (file === canonical || file.startsWith(prefix)) {
        this.files.delete(file);
      }
    }

    for (const directory of [...this.directories]) {
      if (directory === canonical || directory.startsWith(prefix)) {
        this.directories.delete(directory);
      }
    }
  }

  public async list(absDir: string): Promise<string[]> {
    const canonical = canonicalize(absDir);
    const prefix = canonical === "/" ? "/" : `${canonical}/`;
    const children = new Set<string>();

    const collect = (key: string): void => {
      if (!key.startsWith(prefix) || key === canonical) {
        return;
      }

      const remainder = key.slice(prefix.length);
      const nextSlash = remainder.indexOf("/");
      const childName =
        nextSlash === -1 ? remainder : remainder.slice(0, nextSlash);

      if (childName.length > 0) {
        children.add(`${prefix}${childName}`);
      }
    };

    for (const file of this.files.keys()) {
      collect(file);
    }

    for (const directory of this.directories) {
      collect(directory);
    }

    return [...children].sort();
  }

  public async realpath(absPath: string): Promise<string> {
    return canonicalize(absPath);
  }

  public async exec(
    command: string,
    opts?: WorkspaceBackendExecOptions,
  ): Promise<WorkspaceBackendExecResult> {
    // Honour the contract's pre-aborted rule: nothing "runs".
    if (opts?.signal?.aborted) {
      return { exitCode: 130, stdout: "", stderr: "", timedOut: false, cancelled: true };
    }

    const scripted = this.commands.get(command);

    return {
      exitCode: scripted?.exitCode ?? 0,
      stdout: scripted?.stdout ?? "",
      stderr: scripted?.stderr ?? "",
      timedOut: scripted?.timedOut ?? false,
      cancelled: scripted?.cancelled ?? false,
    };
  }
}

/**
 * Create an in-memory {@link WorkspaceBackend} for fast, disk-free tests.
 *
 * Every IO method operates on a `Map` of `absolutePath -> content` (with a
 * companion directory set), so reads, writes, existence checks, `mkdir`,
 * recursive `remove`, `list`, and `realpath` all run synchronously in
 * memory with no filesystem access. `exec` is **scripted**: a registered
 * `command -> result` table is consulted by exact command line, and any
 * unregistered command resolves to a successful `0`-exit no-op with empty
 * output.
 *
 * `realpath` is a pure lexical canonicalization (forward slashes,
 * collapsed separators, resolved `.`/`..`) — there are no symlinks in
 * memory — which is exactly what the jail resolver expects.
 *
 * The single positional `seed` accepts either the shorthand
 * `Record<string, string>` of file contents (matching the design's
 * `ai.workspace.mock(seed)` signature) or the richer {@link MockBackendSeed}
 * with both `files` and scripted `commands`.
 *
 * @example
 * // Shorthand: seed files only.
 * const backend = createMockBackend({ "/srv/app/src/index.ts": "export const x = 1;" });
 * await backend.readFile("/srv/app/src/index.ts"); // "export const x = 1;"
 *
 * @example
 * // Full seed: files plus a scripted command.
 * const backend = createMockBackend({
 *   files: { "/srv/app/package.json": "{}" },
 *   commands: { "npm test": { exitCode: 1, stderr: "1 failing" } },
 * });
 * await backend.exec("npm test");   // { exitCode: 1, stderr: "1 failing", ... }
 * await backend.exec("echo hi");    // { exitCode: 0, stdout: "", ... } (no-op)
 */
export function createMockBackend(
  seed?: Record<string, string> | MockBackendSeed,
): WorkspaceBackend {
  return new MockBackend(normalizeSeed(seed));
}

/** Coerce the dual-shaped `seed` argument into a {@link MockBackendSeed}. */
function normalizeSeed(
  seed?: Record<string, string> | MockBackendSeed,
): MockBackendSeed | undefined {
  if (seed === undefined) {
    return undefined;
  }

  if (isMockBackendSeed(seed)) {
    return seed;
  }

  return { files: seed };
}

/**
 * Whether `seed` is the structured {@link MockBackendSeed} (has a `files`
 * or `commands` key) rather than the flat `path -> content` shorthand. A
 * plain shorthand map whose only key happens to be named `files` is
 * treated as structured — callers wanting that literal path should use the
 * explicit `{ files: { files: "..." } }` form.
 */
function isMockBackendSeed(
  seed: Record<string, string> | MockBackendSeed,
): seed is MockBackendSeed {
  return (
    typeof (seed as MockBackendSeed).files === "object" ||
    typeof (seed as MockBackendSeed).commands === "object"
  );
}
