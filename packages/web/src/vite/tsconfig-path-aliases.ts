import fs from "node:fs";
import path from "node:path";
import type { AppConventionAlias } from "./app-convention-aliases";

/** Removes `//` and block comments and trailing commas so a tsconfig parses as JSON. */
function stripJsonc(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (char === '"') {
      let end = index + 1;
      while (end < source.length && source[end] !== '"') end += source[end] === "\\" ? 2 : 1;
      output += source.slice(index, end + 1);
      index = end + 1;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index++;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      output += char;
      index++;
    }
  }

  return output.replace(/,(\s*[}\]])/g, "$1");
}

type TsconfigShape = {
  extends?: string;
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
};

function readTsconfig(file: string): TsconfigShape | undefined {
  try {
    return JSON.parse(stripJsonc(fs.readFileSync(file, "utf8"))) as TsconfigShape;
  } catch {
    return undefined;
  }
}

/**
 * The `paths` a tsconfig declares, with `extends` followed through relative
 * files. A child's `paths` replaces its parent's, as TypeScript does. `baseUrl`
 * (or, absent that, the directory of the file that declares `paths`) anchors
 * the targets.
 */
function collectPaths(
  file: string,
  depth = 0,
): { paths: Record<string, string[]>; base: string } | undefined {
  const config = readTsconfig(file);
  if (config === undefined || depth > 5) return undefined;

  const directory = path.dirname(file);
  const options = config.compilerOptions;

  if (options?.paths !== undefined) {
    return {
      paths: options.paths,
      base: options.baseUrl === undefined ? directory : path.resolve(directory, options.baseUrl),
    };
  }

  if (typeof config.extends === "string" && config.extends.startsWith(".")) {
    const parent = path.resolve(
      directory,
      config.extends.endsWith(".json") ? config.extends : `${config.extends}.json`,
    );
    return collectPaths(parent, depth + 1);
  }

  return undefined;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mirrors the application's own tsconfig `paths` (for example `@shared/*`)
 * into Vite aliases, so an alias that typechecks also resolves in dev and in
 * the production client build. Vite does not read tsconfig `paths` itself.
 *
 * Only a pattern of the shapes TypeScript uses in practice is mirrored: an
 * exact name, or a name ending in `/*`. The first target of each pattern is
 * used. Aliases the caller passes explicitly, and the `web/*` and `app/*`
 * convention, come earlier in the alias list and therefore win a conflict.
 */
export function tsconfigPathAliases(appRoot: string): AppConventionAlias[] {
  const found = collectPaths(path.join(appRoot, "tsconfig.json"));
  if (found === undefined) return [];

  const aliases: AppConventionAlias[] = [];

  for (const [pattern, targets] of Object.entries(found.paths)) {
    const target = targets[0];
    if (typeof target !== "string") continue;

    const wildcard = pattern.endsWith("/*");
    if (wildcard !== target.endsWith("/*")) continue;
    if (!wildcard && (pattern.includes("*") || target.includes("*"))) continue;
    if (wildcard && (pattern.slice(0, -2).includes("*") || target.slice(0, -2).includes("*"))) {
      continue;
    }

    if (wildcard) {
      aliases.push({
        find: new RegExp(`^${escapeRegExp(pattern.slice(0, -2))}/`),
        replacement: `${path.resolve(found.base, target.slice(0, -2))}/`,
      });
    } else {
      aliases.push({
        find: new RegExp(`^${escapeRegExp(pattern)}$`),
        replacement: path.resolve(found.base, target),
      });
    }
  }

  return aliases;
}
