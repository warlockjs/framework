/**
 * Vite/Vitest plugin that keeps the `unit` project unit.
 *
 * The unit project never boots the app: no config hooks, no connectors, no HTTP
 * server. A spec there that imports a connector, starts a test server or calls
 * `setupTest()` without `{ mode: "unit" }` would run against a framework that was
 * never set up, and the failure shows up as an unrelated `undefined` deep inside
 * the code under test. This plugin fails the spec's own module instead, naming
 * the import and where to move the spec.
 *
 * Only spec files are checked (`*.spec.*` by default). Their helpers and the
 * code under test are not: a service that happens to import a connector is a
 * finding for `warlock check`, not a reason to break a spec that mocks it.
 */

/** Structural, like {@link lowerStage3Decorators}: no `vite` types needed. */
export interface UnitProjectGuardPlugin {
  name: string;
  enforce: "pre";
  transform(code: string, id: string): null;
}

export type GuardUnitProjectOptions = {
  /** Files to check. Defaults to `*.spec.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`. */
  include?: RegExp;
  /** Import names or specifiers to allow, e.g. `["connectorsManager"]` for a spec that only mocks it. */
  allow?: string[];
};

export type UnitGuardViolation = {
  /** What the spec imports or calls, as it appears in the source. */
  what: string;
  /** Why the unit project cannot have it. */
  reason: string;
};

const DEFAULT_INCLUDE = /\.spec\.[cm]?[jt]sx?$/;

/** Named exports of `@warlock.js/core` that need a booted app. */
const APP_EXPORTS = new Set(["connectorsManager", "ConnectorsManager", "bootstrap", "startHttpServer"]);

/** Named exports of `@warlock.js/core/tests` that start the app or its HTTP stack. */
const APP_TEST_EXPORTS = new Set([
  "startHttpTestServer",
  "stopHttpTestServer",
  "createTestHttpServer",
  "testGet",
  "testPost",
  "testPut",
  "testPatch",
  "testDelete",
  "actingAs",
]);

const IMPORT_STATEMENT =
  /\bimport\s+(?:type\s+)?(?:([\w$*\s,{}]+?)\s+from\s+)?["']([^"']+)["']/g;

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/**
 * The text between a call's parentheses, starting just after the opening one.
 * Counts nested parentheses; a string containing one is rare enough in a
 * `setupTest()` argument to ignore.
 */
function callArguments(code: string, start: number): string {
  let depth = 1;

  for (let index = start; index < code.length; index += 1) {
    const character = code[index];

    if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return code.slice(start, index);
  }

  return code.slice(start);
}

function importedNames(clause: string | undefined): string[] {
  if (!clause) return [];

  const braces = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";

  return braces
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim(),
    )
    .filter((name): name is string => Boolean(name));
}

/**
 * The imports and calls in a spec's source that the unit project cannot run.
 * Pure, so the rule is testable without Vite.
 */
export function findUnitGuardViolations(
  source: string,
  options: Pick<GuardUnitProjectOptions, "allow"> = {},
): UnitGuardViolation[] {
  const code = stripComments(source);
  const allowed = new Set(options.allow ?? []);
  const violations: UnitGuardViolation[] = [];

  for (const match of code.matchAll(IMPORT_STATEMENT)) {
    const [statement, clause, specifier = ""] = match;

    if (/^import\s+type\b/.test(statement)) continue;

    const names = importedNames(clause).filter((name) => !allowed.has(name));

    if (specifier === "@warlock.js/core") {
      for (const name of names) {
        if (APP_EXPORTS.has(name) || /Connector$/.test(name)) {
          violations.push({
            what: `${name} from "${specifier}"`,
            reason: "it starts or configures the app's connectors",
          });
        }
      }
    }

    if (specifier === "@warlock.js/core/tests") {
      for (const name of names) {
        if (APP_TEST_EXPORTS.has(name)) {
          violations.push({
            what: `${name} from "${specifier}"`,
            reason: "it needs the booted app and its HTTP server",
          });
        }
      }
    }

    if (
      !allowed.has(specifier) &&
      /^(?:@warlock\.js\/core\/(?:bootstrap|connectors)(?:\/.*)?|(?:\.{1,2}\/)+(?:.*\/)?bootstrap(?:\/index)?)$/.test(
        specifier,
      )
    ) {
      violations.push({
        what: `"${specifier}"`,
        reason: "it is the app bootstrap or a connector",
      });
    }
  }

  if (!allowed.has("setupTest")) {
    for (const call of code.matchAll(/\bsetupTest\s*\(/g)) {
      const argument = callArguments(code, (call.index ?? 0) + call[0].length);

      if (!/mode\s*:\s*["']unit["']/.test(argument)) {
        violations.push({
          what: "setupTest()",
          reason: 'it boots the whole framework unless it is called with { mode: "unit" }',
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * Describe a spec's violations as one error message, or `undefined` when it is
 * clean.
 */
export function describeUnitGuardViolations(
  file: string,
  violations: readonly UnitGuardViolation[],
): string | undefined {
  if (violations.length === 0) return undefined;

  const lines = violations.map((violation) => `  - ${violation.what}: ${violation.reason}`);

  return [
    `[warlock] The unit spec ${file} cannot run in the unit project, which never boots the app:`,
    ...lines,
    "Move the spec to the integration project (name it *.test.ts), or take the import out. " +
      'A spec that only needs config values can call setupTest({ mode: "unit", importModule }).',
  ].join("\n");
}

/**
 * Fail a unit-project spec that imports a connector, starts a test server or
 * calls `setupTest()` outside unit mode. Add it to the `unit` project's plugins.
 *
 * @example
 * // vite.config.ts
 * projects: [{ extends: true, plugins: [guardUnitProject()], test: { name: "unit", ... } }]
 */
export function guardUnitProject(options: GuardUnitProjectOptions = {}): UnitProjectGuardPlugin {
  const include = options.include ?? DEFAULT_INCLUDE;

  return {
    name: "warlock:guard-unit-project",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;

      if (!include.test(file) || file.includes("/node_modules/")) return null;

      const message = describeUnitGuardViolations(
        file,
        findUnitGuardViolations(code, { allow: options.allow }),
      );

      if (!message) return null;

      throw new Error(message);
    },
  };
}
