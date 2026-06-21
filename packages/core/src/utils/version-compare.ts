/**
 * Zero-dependency semver comparison — just enough for the framework's
 * self-update tooling (the dev-server update notice + the `warlock update`
 * command).
 *
 * We deliberately avoid pulling in a semver library: the only question these
 * callers ask is "is the published version newer than what's installed?".
 */

type ParsedVersion = {
  /** Numeric core as `[major, minor, patch]`. */
  core: [number, number, number];
  /** Dot-separated prerelease identifiers; empty for a stable release. */
  prerelease: string[];
};

/**
 * Parse a semver string into its numeric core + prerelease identifiers.
 * Tolerates a leading `v` and ignores build metadata (`+…`). Returns
 * `undefined` when the core isn't exactly three non-negative integers.
 */
function parseVersion(version: string): ParsedVersion | undefined {
  const cleaned = version.trim().replace(/^v/i, "");
  const [coreAndPrerelease] = cleaned.split("+"); // drop build metadata
  const [core, ...prereleaseParts] = coreAndPrerelease.split("-");
  const segments = core.split(".");

  if (segments.length !== 3) {
    return undefined;
  }

  const numbers = segments.map((segment) => Number(segment));

  if (numbers.some((value) => !Number.isInteger(value) || value < 0)) {
    return undefined;
  }

  const prerelease = prereleaseParts.length > 0 ? prereleaseParts.join("-").split(".") : [];

  return {
    core: [numbers[0], numbers[1], numbers[2]],
    prerelease,
  };
}

/**
 * Compare two prerelease identifier lists per semver rules: numeric
 * identifiers compare numerically, alphanumeric ones lexically, a numeric
 * identifier ranks below an alphanumeric one, and a longer list wins when
 * otherwise equal. Returns a negative / zero / positive number.
 */
function comparePrerelease(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const a = left[index];
    const b = right[index];

    if (a === undefined) {
      return -1;
    }

    if (b === undefined) {
      return 1;
    }

    const aIsNumeric = /^\d+$/.test(a);
    const bIsNumeric = /^\d+$/.test(b);

    if (aIsNumeric && bIsNumeric) {
      const diff = Number(a) - Number(b);

      if (diff !== 0) {
        return diff;
      }

      continue;
    }

    if (aIsNumeric !== bIsNumeric) {
      return aIsNumeric ? -1 : 1;
    }

    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Return `true` when `latest` is a strictly newer semantic version than
 * `current`. Compares the numeric `major.minor.patch` first, then treats a
 * stable release as newer than a prerelease of the same core
 * (`1.2.0` > `1.2.0-beta`). Unparseable input yields `false` — we never nag
 * on a version string we can't understand.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const latestParsed = parseVersion(latest);
  const currentParsed = parseVersion(current);

  if (!latestParsed || !currentParsed) {
    return false;
  }

  for (let index = 0; index < 3; index++) {
    if (latestParsed.core[index] !== currentParsed.core[index]) {
      return latestParsed.core[index] > currentParsed.core[index];
    }
  }

  // Equal numeric core — order by prerelease (a stable release beats a prerelease).
  const latestIsStable = latestParsed.prerelease.length === 0;
  const currentIsStable = currentParsed.prerelease.length === 0;

  if (latestIsStable && currentIsStable) {
    return false;
  }

  if (latestIsStable !== currentIsStable) {
    return latestIsStable;
  }

  return comparePrerelease(latestParsed.prerelease, currentParsed.prerelease) > 0;
}
