/**
 * The small glob language of `Files:`, `Locked:` and the protected areas:
 * `**` crosses folders, `*` and `?` stay inside one, `{a,b}` picks one.
 * A plain path (no wildcard) matches itself and everything under it.
 */

const cache = new Map<string, RegExp>();

/** Split a comma list, leaving commas inside `{…}` alone. Entries are trimmed; empty ones dropped. */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of value) {
    if (char === "{") depth++;
    if (char === "}") depth = Math.max(0, depth - 1);

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts
    .map((part) =>
      part
        .trim()
        .replace(/^`+|`+$/g, "")
        .trim(),
    )
    .filter((part) => part !== "");
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|/-]/.test(char) ? `\\${char}` : char;
}

function toSource(glob: string): string {
  let source = "";
  let braces = 0;

  for (let index = 0; index < glob.length; index++) {
    const char = glob[index] ?? "";

    if (char === "*") {
      if (glob[index + 1] === "*") {
        const after = glob[index + 2];

        if (after === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") source += "[^/]";
    else if (char === "{") {
      braces++;
      source += "(?:";
    } else if (char === "}" && braces > 0) {
      braces--;
      source += ")";
    } else if (char === "," && braces > 0) source += "|";
    else source += escapeRegExp(char);
  }

  return source + ")".repeat(braces);
}

/** The pattern of a glob. */
export function globToRegExp(glob: string): RegExp {
  const key = glob;
  const known = cache.get(key);

  if (known) return known;

  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  const plain = !/[*?{]/.test(normalized);
  const folder = normalized.replace(/\/+$/, "");
  const regex = plain
    ? new RegExp(`^${toSource(folder)}(?:/.*)?$`)
    : new RegExp(`^${toSource(normalized.endsWith("/") ? `${folder}/**` : normalized)}$`);

  cache.set(key, regex);

  return regex;
}

/** Whether a project-relative path matches the glob. */
export function matchesGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file.replace(/\\/g, "/"));
}

/** Whether a path matches any of the globs. */
export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(file, glob));
}
