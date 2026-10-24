type ParsedVersion = { core: [number, number, number]; prerelease: string[] };

function parseVersion(version: string): ParsedVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );

  if (!match) {
    throw new Error(`"${version}" is not a valid semantic version (expected MAJOR.MINOR.PATCH).`);
  }

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // A version without a prerelease tag is greater than one with it.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];

    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;

    return left < right ? -1 : 1;
  }

  return 0;
}

/**
 * Compare two semantic versions. Returns a negative number when `a < b`,
 * zero when equal and a positive number when `a > b`. Build metadata is
 * ignored. Throws on a string that is not a semantic version.
 *
 * @example
 * compareVersions("1.2.0", "1.10.0"); // < 0
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  for (let index = 0; index < 3; index++) {
    const difference = left.core[index]! - right.core[index]!;

    if (difference !== 0) return difference < 0 ? -1 : 1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}
