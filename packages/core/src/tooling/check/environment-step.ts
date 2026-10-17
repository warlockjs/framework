import { readFileSync } from "node:fs";
import path from "node:path";
import { createProblem, type ToolingProblem } from "../problem";

/**
 * The oldest Node.js release core supports — `engines.node` in core's
 * package.json (`>=22.15`). `bin/warlock.js` refuses older versions before
 * the CLI loads; this check covers programmatic `runCheck()` calls too.
 */
export const MIN_NODE_VERSION = "22.15.0";

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());

  if (!match) return undefined;

  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
}

/**
 * The minimum version of a `>=x.y.z` engines range, or `undefined` for any
 * other form (`^22`, `22.x || 24.x`): those are not interpreted rather than
 * guessed at.
 */
export function minimumOfRange(range: string): string | undefined {
  const match = /^\s*>=\s*v?(\d+(?:\.\d+){0,2})\s*$/.exec(range);

  return match?.[1];
}

function appEnginesRange(cwd: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
    const engines =
      typeof manifest === "object" && manifest !== null
        ? Reflect.get(manifest, "engines")
        : undefined;
    const node =
      typeof engines === "object" && engines !== null ? Reflect.get(engines, "node") : undefined;

    return typeof node === "string" ? node : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check the running Node.js against core's minimum and the app's own
 * `engines.node` (when it is a plain `>=` range). A mismatch is a `WL8001`
 * environment problem.
 */
export function checkNodeVersion(cwd: string, running = process.versions.node): ToolingProblem[] {
  const current = parseVersion(running);

  if (!current) return [];

  const requirements: { minimum: string; source: string }[] = [
    { minimum: MIN_NODE_VERSION, source: "@warlock.js/core (engines.node >=22.15)" },
  ];
  const appRange = appEnginesRange(cwd);
  const appMinimum = appRange ? minimumOfRange(appRange) : undefined;

  if (appMinimum) {
    requirements.push({ minimum: appMinimum, source: `package.json engines.node ${appRange}` });
  }

  const problems: ToolingProblem[] = [];

  for (const requirement of requirements) {
    const minimum = parseVersion(requirement.minimum);

    if (minimum && compareVersions(current, minimum) < 0) {
      problems.push(
        createProblem({
          code: "WL8001",
          source: "environment",
          message: `Node.js ${running} is older than ${requirement.minimum}, required by ${requirement.source}.`,
        }),
      );
    }
  }

  return problems;
}
