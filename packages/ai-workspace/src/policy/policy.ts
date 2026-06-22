import path from "node:path";
import { realpath } from "node:fs/promises";
import { WorkspacePolicyError } from "../errors";
import type { WorkspacePolicy } from "../contracts";

/**
 * The outcome of resolving a workspace-relative (or absolute) input path
 * against the jail — the canonical absolute location the backend should
 * touch, plus the workspace-relative form (POSIX-style, `/`-separated)
 * the agent and tool results echo back.
 */
export interface ResolvedPath {
  /** Canonical absolute path (symlinks in existing ancestors collapsed). */
  absolutePath: string;
  /**
   * The path relative to `policy.cwd`, `/`-separated regardless of OS,
   * used in tool results so the agent always sees stable workspace paths.
   * Empty string when the resolved path IS the jail root.
   */
  relativePath: string;
}

/**
 * Resolve the canonical absolute form of `target`, collapsing any
 * symlinks. `target` may not yet exist (a fresh `writeFile`/`mkdir`),
 * so we realpath the deepest **existing** ancestor and re-attach the
 * non-existent tail — a symlinked ancestor still cannot smuggle the
 * path out of the jail, while genuinely new leaves stay creatable.
 */
async function canonicalize(target: string): Promise<string> {
  let resolvedTarget = path.resolve(target);
  const tail: string[] = [];

  // Walk up until an existing ancestor is found (or we hit the root).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const real = await realpath(resolvedTarget);

      return tail.length > 0 ? path.join(real, ...tail) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      // Only ENOENT means "this segment doesn't exist yet" — keep
      // walking up. Any other error (EACCES, ELOOP, …) is a real fault.
      if (code !== "ENOENT") {
        throw error;
      }

      const parent = path.dirname(resolvedTarget);

      // Reached the filesystem root without finding an existing
      // ancestor — give back the lexically-resolved path unchanged.
      if (parent === resolvedTarget) {
        return path.join(resolvedTarget, ...tail);
      }

      tail.unshift(path.basename(resolvedTarget));
      resolvedTarget = parent;
    }
  }
}

/**
 * Whether `child` is contained within `root` (or equals it), comparing
 * canonical absolute paths. Guards against the `/srv/app-evil` vs
 * `/srv/app` prefix-collision by anchoring on a path separator.
 */
function isInside(child: string, root: string): boolean {
  const relative = path.relative(root, child);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Translate a glob (the small subset used by `denyPaths` — `*`, `**`,
 * `?`) into an anchored `RegExp` over a `/`-separated relative path.
 * `**` spans path separators; a single `*` does not.
 */
function globToRegExp(glob: string): RegExp {
  let source = "";

  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];

    if (char === "*") {
      if (glob[index + 1] === "*") {
        // `**` — match across segments (and an optional trailing slash).
        source += ".*";
        index++;

        if (glob[index + 1] === "/") {
          index++;
        }
      } else {
        // `*` — match within a single segment.
        source += "[^/]*";
      }

      continue;
    }

    if (char === "?") {
      source += "[^/]";

      continue;
    }

    // Escape everything else so it matches literally.
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp(`^${source}$`);
}

/**
 * Whether a workspace-relative (`/`-separated) path matches any of the
 * policy's `denyPaths` globs. A deny glob also blocks everything beneath
 * a matched directory (`".git/**"` blocks `.git/config`).
 */
function matchesDeny(relativePath: string, denyPaths: string[]): boolean {
  return denyPaths.some((glob) => {
    if (globToRegExp(glob).test(relativePath)) {
      return true;
    }

    // A bare directory glob (`".git"`, `"node_modules"`) should also
    // block its contents, mirroring how `".git/**"` would behave.
    if (!glob.includes("*") && !glob.includes("?")) {
      const prefix = glob.endsWith("/") ? glob : `${glob}/`;

      return relativePath.startsWith(prefix);
    }

    return false;
  });
}

/**
 * Resolve and jail a single input path against a {@link WorkspacePolicy}.
 *
 * The input is resolved against `policy.cwd`, canonicalized (symlinks in
 * existing ancestors collapsed so a symlinked directory cannot escape
 * the jail), then accepted **only** when it sits under `cwd` or one of
 * the `allowPaths` roots. A path that escapes, or that matches any
 * `denyPaths` glob even while inside `cwd`, is rejected with a
 * {@link WorkspacePolicyError} of type `"path-escape"`.
 *
 * @param policy - The bounding policy (its `cwd` is the jail root).
 * @param inputPath - A workspace-relative or absolute path to resolve.
 * @returns The canonical absolute path plus its `/`-separated relative form.
 * @throws {WorkspacePolicyError} When the path escapes the jail or hits a deny glob.
 *
 * @example
 * const { absolutePath } = await resolveInJail(policy, "src/index.ts");
 */
export async function resolveInJail(
  policy: WorkspacePolicy,
  inputPath: string,
): Promise<ResolvedPath> {
  const jailRoot = await canonicalize(policy.cwd);
  const requested = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(policy.cwd, inputPath);
  const absolutePath = await canonicalize(requested);

  const insideCwd = isInside(absolutePath, jailRoot);
  const allowRoots = policy.allowPaths ?? [];
  let insideAllow = false;

  if (!insideCwd) {
    for (const root of allowRoots) {
      const canonicalRoot = await canonicalize(root);

      if (isInside(absolutePath, canonicalRoot)) {
        insideAllow = true;

        break;
      }
    }
  }

  if (!insideCwd && !insideAllow) {
    throw new WorkspacePolicyError(
      `Path "${inputPath}" resolves outside the workspace jail.`,
      { type: "path-escape", path: inputPath },
    );
  }

  // `denyPaths` is evaluated relative to the jail root and wins even
  // when the path is comfortably inside `cwd`.
  const relativeToJail = insideCwd
    ? path.relative(jailRoot, absolutePath).split(path.sep).join("/")
    : "";

  if (insideCwd && policy.denyPaths && policy.denyPaths.length > 0) {
    if (matchesDeny(relativeToJail, policy.denyPaths)) {
      throw new WorkspacePolicyError(
        `Path "${inputPath}" is blocked by the workspace deny list.`,
        { type: "path-escape", path: inputPath },
      );
    }
  }

  return { absolutePath, relativePath: relativeToJail };
}

/**
 * Extract the leading executable basename from a command line — the
 * token the shell allow/deny policy is keyed on. `"npm run build"` →
 * `"npm"`; `"/usr/bin/node app.js"` → `"node"`; `"node.exe app"` →
 * `"node"` (the `.exe`/`.cmd`/`.bat` Windows extension is stripped).
 */
function leadingExecutable(command: string): string {
  const trimmed = command.trim();
  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  const base = path.basename(firstToken);

  return base.replace(/\.(exe|cmd|bat|com)$/i, "");
}

/**
 * Whether a shell command is permitted by the policy's `shell` sub-policy.
 *
 * The command's leading executable basename is matched against
 * `shell.deny` then `shell.allow`. **Deny always wins.** When
 * `shell.allow` is set, the executable MUST appear in it (fail-closed
 * allowlist); when `allow` is absent/empty, any non-denied command is
 * permitted. An absent `shell` block means no command may run at all.
 *
 * Returns a plain `boolean` rather than throwing — the ops layer raises
 * the {@link WorkspacePolicyError} so the thrown context (`command`)
 * lives next to the call site.
 *
 * @example
 * isCommandAllowed({ cwd, shell: { allow: ["npm"] } }, "npm test"); // true
 * isCommandAllowed({ cwd, shell: { allow: ["npm"] } }, "rm -rf /"); // false
 */
export function isCommandAllowed(
  policy: WorkspacePolicy,
  command: string,
): boolean {
  const shell = policy.shell;

  // No shell sub-policy ⇒ fail-closed: nothing may run.
  if (!shell) {
    return false;
  }

  const executable = leadingExecutable(command);

  if (executable === "") {
    return false;
  }

  // Deny wins over everything else.
  if (shell.deny && shell.deny.includes(executable)) {
    return false;
  }

  // An allowlist, when present, is exhaustive.
  if (shell.allow && shell.allow.length > 0) {
    return shell.allow.includes(executable);
  }

  // No allowlist: anything not explicitly denied is permitted.
  return true;
}

/**
 * Build the exact environment a spawned process receives — `process.env`
 * is **never** inherited wholesale. The result is
 * `{ ...pick(process.env, inheritEnv), ...shell.env }`, so a command
 * cannot see `PATH` (and thus often cannot find `node`/`npm`) unless the
 * policy opts in via `shell.inheritEnv: ["PATH"]`. Explicit `shell.env`
 * values override inherited ones on key collision.
 *
 * @example
 * buildEnv({ cwd, shell: { inheritEnv: ["PATH"], env: { CI: "1" } } });
 * // → { PATH: <process PATH>, CI: "1" }
 */
export function buildEnv(policy: WorkspacePolicy): Record<string, string> {
  const shell = policy.shell;
  const env: Record<string, string> = {};

  if (!shell) {
    return env;
  }

  for (const key of shell.inheritEnv ?? []) {
    const value = process.env[key];

    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (shell.env) {
    for (const [key, value] of Object.entries(shell.env)) {
      env[key] = value;
    }
  }

  return env;
}
