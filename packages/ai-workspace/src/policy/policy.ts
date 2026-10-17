import path from "node:path";
import { realpath } from "node:fs/promises";
import { WorkspacePolicyError } from "../errors";
import type { WorkspacePolicy } from "../contracts";
import { isInside, matchesAnyGlob } from "./jail";
import { checkShellCommand } from "./shell-check";

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
 * Resolve and jail a single input path against a {@link WorkspacePolicy}.
 *
 * The input is resolved against `policy.cwd`, canonicalized (symlinks in
 * existing ancestors collapsed so a symlinked directory cannot escape
 * the jail), then accepted **only** when it sits under `cwd` or one of
 * the `allowPaths` roots. A path that escapes, or that matches any
 * `denyPaths` glob even while inside `cwd`, is rejected with a
 * {@link WorkspacePolicyError} of type `"path-escape"`.
 *
 * Why this does not use `@warlock.js/fs`'s confined reader (`fs.confined`):
 * the two answer different questions. The confined reader refuses absolute
 * paths, refuses every symbolic link (or follows only links inside its one
 * root), requires the path to exist, and reads the file itself through a
 * no-follow, identity-checked open. This jail must instead accept absolute
 * paths inside `cwd`, several `allowPaths` roots, `denyPaths` globs, a
 * symlinked `cwd`, links whose target stays inside, and paths that do not
 * exist yet (`writeFile`, `mkdir`), and it returns a path that writes,
 * `exec`'s working directory and redirections use afterwards. Switching would
 * change what agents may touch, so the workspace keeps this resolver.
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
  const requested = path.isAbsolute(inputPath) ? inputPath : path.join(policy.cwd, inputPath);
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
    throw new WorkspacePolicyError(`Path "${inputPath}" resolves outside the workspace jail.`, {
      type: "path-escape",
      path: inputPath,
    });
  }

  // `denyPaths` is evaluated relative to the jail root and wins even
  // when the path is comfortably inside `cwd`.
  const relativeToJail = insideCwd
    ? path.relative(jailRoot, absolutePath).split(path.sep).join("/")
    : "";

  if (insideCwd && policy.denyPaths && policy.denyPaths.length > 0) {
    if (matchesAnyGlob(relativeToJail, policy.denyPaths)) {
      throw new WorkspacePolicyError(`Path "${inputPath}" is blocked by the workspace deny list.`, {
        type: "path-escape",
        path: inputPath,
      });
    }
  }

  return { absolutePath, relativePath: relativeToJail };
}

/**
 * Whether a command line is permitted by the policy's `shell` sub-policy —
 * `checkShellCommand(policy, command).allowed`.
 *
 * In argv mode (the default) the command must tokenize into a single argv
 * (no unquoted `;`, `&&`, `|`, backticks, `$`, redirection, …): the backend
 * spawns it with no shell, and unquoted metacharacters were exactly how an
 * injected command chain used to ride past the allowlist. In shell mode
 * (`interpreter: "sh"`) every simple command in the line is checked. Each
 * argv's executable basename is matched against `shell.deny` (wins, case
 * insensitive) then `shell.allow` (exhaustive when non-empty), then
 * `shell.denyPatterns` and `shell.allowCommand`. An absent `shell` block
 * means no command may run at all.
 *
 * Returns a plain `boolean`; use {@link checkShellCommand} for the reason
 * and the model-facing message. Redirection targets are checked lexically
 * here; `exec` re-checks them with symlinks resolved.
 *
 * @example
 * isCommandAllowed({ cwd, shell: { allow: ["npm"] } }, "npm test"); // true
 * isCommandAllowed({ cwd, shell: { allow: ["npm"] } }, "rm -rf /"); // false
 * isCommandAllowed({ cwd, shell: { allow: ["npm"] } }, "npm test; rm -rf /"); // false
 */
export function isCommandAllowed(policy: WorkspacePolicy, command: string): boolean {
  return checkShellCommand(policy, command).allowed;
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

/**
 * Variables removed from the environment of a shell-mode (`interpreter:
 * "sh"`) command: each changes how the shell itself starts, parses or
 * resolves the line (`ENV`/`BASH_ENV` run a startup file, `SHELLOPTS` +
 * `PS4` can run command substitutions, `BASH_FUNC_*` imports functions that
 * shadow commands, `CDPATH` moves `cd`, `IFS` re-splits words).
 */
const SHELL_STARTUP_VARIABLES = new Set([
  "ENV",
  "BASH_ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "CDPATH",
  "IFS",
  "PS4",
  "GLOBIGNORE",
]);

/**
 * The environment a command actually receives: {@link buildEnv}, minus the
 * shell start-up variables when the policy runs lines through a shell.
 * Compared case-insensitively, because Windows environment names are.
 */
export function buildCommandEnv(policy: WorkspacePolicy): Record<string, string> {
  const env = buildEnv(policy);

  if ((policy.shell?.interpreter ?? "none") !== "sh") {
    return env;
  }

  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();

    if (SHELL_STARTUP_VARIABLES.has(upper) || upper.startsWith("BASH_FUNC_")) {
      delete env[key];
    }
  }

  return env;
}
