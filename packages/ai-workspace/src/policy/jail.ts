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
 * Translate a glob (the small subset used by `denyPaths` and
 * `list.ignore` — `*`, `**`, `?`) into an anchored `RegExp` over a
 * `/`-separated relative path. `**` spans path separators; a single `*`
 * does not.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";

  for (let index = 0; index < glob.length; index++) {
    const char = glob.charAt(index);

    if (char === "*") {
      if (glob.charAt(index + 1) === "*") {
        // `**` — match across segments (and an optional trailing slash).
        source += ".*";
        index++;

        if (glob.charAt(index + 1) === "/") {
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
 * globs. A glob also covers everything beneath a matched directory
 * (`".git/**"` covers `.git/config`), and a bare name without wildcards
 * (`".git"`, `"node_modules"`) covers its contents.
 */
export function matchesAnyGlob(relativePath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
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
