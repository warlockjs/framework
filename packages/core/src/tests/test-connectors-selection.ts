/**
 * Effective connector selection for the worker test lifecycle.
 *
 * Owns one decision: given what the caller passed and what the project
 * configured, which connectors does `setupTest` actually start? The precedence
 * is ratified in `contracts/2026-08-12-test-worker-lifecycle.md`:
 *
 *     explicit non-`undefined` setupTest option > tests.connectors config > true
 */
import type { GenericObject } from "@mongez/reinforcements";
import { config } from "../config";
import type { ConnectorName } from "../connectors";

/**
 * What a test runtime was asked to start.
 *
 * - `false` — bootstrap the runtime, start no connectors.
 * - `true` — start the framework's default connector set.
 * - an array — start exactly those. Order is not promised; lifecycle priority
 *   decides the real boot/shutdown order.
 */
export type TestConnectorsSelection = boolean | ConnectorName[];

/**
 * A caller's request, before the lower precedence layers are consulted.
 *
 * The distinction that matters is "did the caller supply a value at all", not
 * "what value" — `setupTest({ connectors: undefined })` must fall through to
 * project config exactly like `setupTest()` does, so an optional variable
 * holding `undefined` can never silently erase a project's configuration.
 */
export type RequestedTestConnectors =
  | { readonly isExplicit: true; readonly selection: TestConnectorsSelection }
  | { readonly isExplicit: false };

/**
 * Classify the caller's `connectors` option as explicit or deferred.
 */
export function readRequestedConnectors(
  selection: TestConnectorsSelection | undefined,
): RequestedTestConnectors {
  if (selection === undefined) {
    return { isExplicit: false };
  }

  return { isExplicit: true, selection };
}

/**
 * Read the `tests.connectors` config layer, or `undefined` when the project has
 * not configured one.
 *
 * Only meaningful once config files are loaded — before that, every project
 * looks like a project without a `tests` config.
 */
export function readConfiguredConnectors(): TestConnectorsSelection | undefined {
  // The default matters: `config.get` resolves an absent key to its default, and
  // ITS default is `null` — not `{}`. `warlock add test` does not generate
  // `src/config/tests.ts`, so reading `.connectors` off the result threw
  // "Cannot read properties of null" on the generated default path.
  const testsConfig = config.get<GenericObject>("tests", {});

  // Cast at the config boundary: `GenericObject` values are untyped, and this is
  // the one place the untyped value becomes a typed selection.
  return testsConfig?.connectors as TestConnectorsSelection | undefined;
}

/**
 * Apply the ratified precedence:
 *
 *     explicit non-`undefined` setupTest option > tests.connectors config > true
 *
 * ⚠ This is the reverse of 4.13, where config won over the parameter. Explicit
 * call-site intent beats a project default; a call that supplied nothing is not
 * intent, which is why "omitted" and "explicitly `undefined`" both defer.
 */
export function resolveEffectiveConnectors(
  requested: RequestedTestConnectors,
): TestConnectorsSelection {
  if (requested.isExplicit) {
    return requested.selection;
  }

  const configured = readConfiguredConnectors();

  if (configured !== undefined) {
    return configured;
  }

  return true;
}

/**
 * Deduplicate a connector list and put it in a stable order.
 *
 * Two callers naming the same connectors in a different order asked for the same
 * thing, so the lifecycle must not treat them as a conflict.
 */
export function normalizeConnectorNames(names: ConnectorName[]): ConnectorName[] {
  return [...new Set(names)].sort();
}

/**
 * Compare two selections by normalized semantics — arrays as deduplicated sets,
 * never by caller order.
 */
export function isSameConnectorsSelection(
  left: TestConnectorsSelection,
  right: TestConnectorsSelection,
): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    const normalizedLeft = normalizeConnectorNames(left);
    const normalizedRight = normalizeConnectorNames(right);

    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((name, index) => name === normalizedRight[index])
    );
  }

  return left === right;
}

/**
 * Render a selection for an error message a caller can act on.
 */
export function describeConnectorsSelection(selection: TestConnectorsSelection): string {
  if (selection === true) {
    return "the default connector set (`connectors: true`)";
  }

  if (selection === false) {
    return "no connectors (`connectors: false`)";
  }

  const names = normalizeConnectorNames(selection)
    .map((name) => `"${name}"`)
    .join(", ");

  return `\`connectors: [${names}]\``;
}
