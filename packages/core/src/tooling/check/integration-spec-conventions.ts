import { readFileSync } from "node:fs";
import path from "node:path";
import { importSpecifiers } from "../syntax/imports";
import { createProblem, type ToolingProblem } from "../problem";

/**
 * Integration specs are the ones the generated Vitest layout runs with the
 * booted app: every `*.spec.ts(x)` and `*.test.ts(x)` file except `*.unit.*`,
 * and anything under a `tests/` folder.
 */
const INTEGRATION_SPEC =
  /(?:^|\/)(?!.*\.unit\.(?:spec|test)\.)(?:[^/]*\.(?:spec|test)\.[cm]?[jt]sx?|tests\/.*\.[cm]?[jt]sx?)$/;

/** `@warlock.js` packages whose imports need no booted app. */
const PURE_PACKAGES = new Set(["@warlock.js/seal"]);

/** How far through the spec's own relative imports the search for the app goes. */
const DEPTH = 2;

type Resolve = (specifier: string, importer: string) => string | undefined;

function readSource(cwd: string, file: string): string | undefined {
  try {
    return readFileSync(path.join(cwd, file), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Whether `source` reaches the app: a framework import other than the pure
 * packages, an `app/` alias import, or (within {@link DEPTH} levels) a relative
 * import of a file that does.
 */
function touchesApp(
  file: string,
  source: string,
  cwd: string,
  resolve: Resolve,
  depth: number,
  seen: Set<string>,
): boolean {
  let imports: ReturnType<typeof importSpecifiers>;

  try {
    imports = importSpecifiers(file, source);
  } catch {
    // A file that does not parse is not evidence either way.
    return true;
  }

  for (const { specifier } of imports) {
    if (specifier.startsWith("@warlock.js/")) {
      const packageName = specifier.split("/").slice(0, 2).join("/");

      if (!PURE_PACKAGES.has(packageName)) return true;

      continue;
    }

    if (specifier.startsWith("app/") || specifier.startsWith("src/")) return true;

    if (!specifier.startsWith(".") || depth <= 0) continue;

    const target = resolve(specifier, file);

    if (!target || seen.has(target)) continue;

    seen.add(target);

    const targetSource = readSource(cwd, target);

    if (
      targetSource !== undefined &&
      touchesApp(target, targetSource, cwd, resolve, depth - 1, seen)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * `WL9024` (warning): an integration spec that never touches the app.
 *
 * Integration specs pay for the booted framework (config, connectors, database)
 * or at least for the integration project's setup file. A spec whose imports
 * reach no framework package, no `app/` module and no file that does is a unit
 * spec in the wrong project; the warning says to rename it to `<name>.unit.spec.ts`.
 *
 * Deliberately conservative: any `@warlock.js/*` import except `seal`, any
 * `app/...` import, or a relative import (two levels deep) that has one, counts
 * as touching the app, so a spec is only named when nothing suggests it needs it.
 */
export function integrationSpecProblems(
  relativePath: string,
  source: string,
  cwd: string,
  resolve: Resolve,
): ToolingProblem[] {
  if (!INTEGRATION_SPEC.test(relativePath)) return [];

  if (touchesApp(relativePath, source, cwd, resolve, DEPTH, new Set([relativePath]))) return [];

  return [
    createProblem({
      code: "WL9024",
      source: "convention",
      severity: "warning",
      message: `${relativePath} runs in the integration project but imports nothing that needs the app. Move it to the unit project: rename it to <name>.unit.spec.ts (outside tests/).`,
      file: relativePath,
      line: 1,
      column: 1,
    }),
  ];
}
