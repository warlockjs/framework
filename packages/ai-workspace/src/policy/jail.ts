import path from "node:path";
import type { WorkspacePolicy } from "../contracts";

/**
 * Whether `child` is contained within `root` (or equals it), comparing
 * absolute paths. Guards against the `/srv/app-evil` vs `/srv/app`
 * prefix-collision by comparing path segments, not string prefixes.
 */
export function isInside(child: string, root: string): boolean {
  const relative = path.relative(root, child);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Longest glob a model may pass to `glob`, `grep` or `list_dir`, and the
 * longest `.gitignore` line that is honoured. Matching costs at most
 * pattern length × path length per path, so this bounds every check.
 */
export const MAX_GLOB_LENGTH = 512;

/** A compiled glob: `test()` answers whether a whole path matches it. */
export interface GlobMatcher {
  test(relativePath: string): boolean;
}

/** Token codes for a compiled glob; a literal is its UTF-16 code unit (>= 0). */
const ONE = -1; // `?` — one character other than `/`
const STAR = -2; // `*` — any run without `/`
const GLOBSTAR = -3; // `**` — any run, `/` included (line terminators excluded)

/** Compiled matchers by glob source, so a walk compiles each glob once. */
const compiledGlobs = new Map<string, GlobMatcher>();
/** Most compiled globs kept before the cache starts over. */
const MAX_COMPILED_GLOBS = 512;

/** Line terminators, which a `**` never spans (as the regex form `.*` never did). */
function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * Tokenize a glob (the small subset used by `denyPaths`, `list.ignore`,
 * `search.skipDirs`, `.gitignore` and the `glob` tool — `*`, `**`, `?`)
 * over a `/`-separated relative path. `**` spans path separators (a `/`
 * right after it is folded into it); a single `*` does not.
 */
function tokenizeGlob(glob: string): Int32Array {
  const tokens: number[] = [];

  for (let index = 0; index < glob.length; index++) {
    const code = glob.charCodeAt(index);

    if (code === 42) {
      // `*`
      if (glob.charCodeAt(index + 1) === 42) {
        index++;

        if (glob.charCodeAt(index + 1) === 47) {
          index++;
        }

        // `**` after `**` adds nothing.
        if (tokens[tokens.length - 1] !== GLOBSTAR) {
          tokens.push(GLOBSTAR);
        }
      } else {
        tokens.push(STAR);
      }

      continue;
    }

    tokens.push(code === 63 ? ONE : code);
  }

  return Int32Array.from(tokens);
}

/**
 * Whether `text` matches the whole token list. A set-of-states walk (each
 * pattern position is visited at most once per character), so the cost is
 * at most `tokens × text` — no input can make it backtrack.
 */
function matchTokens(tokens: Int32Array, text: string): boolean {
  const size = tokens.length;
  // `seen[state] === stamp` marks a state already in the current set.
  const seen = new Int32Array(size + 1).fill(-1);
  let current: number[] = [];
  let next: number[] = [];

  const add = (list: number[], state: number, stamp: number): void => {
    // A wildcard run may match nothing, so entering it also enters the state after it.
    for (let at = state; at <= size && seen[at] !== stamp; at++) {
      seen[at] = stamp;
      list.push(at);

      const token = tokens[at];

      if (token !== STAR && token !== GLOBSTAR) {
        break;
      }
    }
  };

  add(current, 0, 0);

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const stamp = index + 1;

    next.length = 0;

    for (const state of current) {
      const token = tokens[state];

      if (token === undefined) {
        continue;
      }

      if (token === STAR) {
        if (code !== 47) add(next, state, stamp);
      } else if (token === GLOBSTAR) {
        if (!isLineTerminator(code)) add(next, state, stamp);
      } else if (token === ONE) {
        if (code !== 47) add(next, state + 1, stamp);
      } else if (token === code) {
        add(next, state + 1, stamp);
      }
    }

    if (next.length === 0) {
      return false;
    }

    [current, next] = [next, current];
  }

  return current.includes(size);
}

/**
 * Compile a glob into a {@link GlobMatcher} anchored at both ends of a
 * `/`-separated relative path. `**` spans path separators; a single `*`
 * does not; `?` is one character other than `/`; everything else matches
 * literally. Matching never backtracks (see {@link matchTokens}), and
 * compiled globs are cached, so callers may compile per check.
 */
export function compileGlob(glob: string): GlobMatcher {
  const cached = compiledGlobs.get(glob);

  if (cached !== undefined) {
    return cached;
  }

  const tokens = tokenizeGlob(glob);
  const literal = tokens.every((token) => token >= 0);
  const matcher: GlobMatcher = literal
    ? { test: (relativePath) => relativePath === glob }
    : { test: (relativePath) => matchTokens(tokens, relativePath) };

  if (compiledGlobs.size >= MAX_COMPILED_GLOBS) {
    compiledGlobs.clear();
  }

  compiledGlobs.set(glob, matcher);

  return matcher;
}

/**
 * Whether a workspace-relative (`/`-separated) path matches any of the
 * globs. A glob also covers everything beneath a matched directory
 * (`".git/**"` covers `.git/config`), and a bare name without wildcards
 * (`".git"`, `"node_modules"`) covers its contents.
 */
export function matchesAnyGlob(relativePath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    if (compileGlob(glob).test(relativePath)) {
      return true;
    }

    if (!glob.includes("*") && !glob.includes("?")) {
      const prefix = glob.endsWith("/") ? glob : `${glob}/`;

      return relativePath.startsWith(prefix);
    }

    return false;
  });
}

/**
 * The jail check without touching the filesystem: is the absolute path
 * `target` (already resolved lexically) inside `cwd` and off every
 * `denyPaths` glob, or inside an `allowPaths` root? Symlinks are NOT
 * resolved here — the shell policy uses it to refuse obvious escapes
 * synchronously, and `exec` re-checks every path with `resolveInJail`.
 */
export function isInsideJailLexically(policy: WorkspacePolicy, target: string): boolean {
  const root = path.resolve(policy.cwd);

  if (isInside(target, root)) {
    const relative = path.relative(root, target).split(path.sep).join("/");

    return !(
      policy.denyPaths &&
      policy.denyPaths.length > 0 &&
      matchesAnyGlob(relative, policy.denyPaths)
    );
  }

  return (policy.allowPaths ?? []).some((allowRoot) => isInside(target, path.resolve(allowRoot)));
}
