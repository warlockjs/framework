/** Parse `5.31`, `5.31.0`, `v5.31.2`, `^5.30.0` into `[major, minor, patch]`. */
export function parseVersion(value: string): [number, number, number] | undefined {
  const match = /(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?/.exec(value.trim());
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** `5.31` → `5.31.0`; throws on something that is not a version. */
export function normalizeVersion(value: string): string {
  const parsed = parseVersion(value);
  if (!parsed || !/^v?\d{1,6}(\.\d{1,6}){0,2}$/.test(value.trim())) {
    throw new Error(`"${value}" is not a version. Pass one like --to 5.31 or --to 5.31.0.`);
  }

  return parsed.join(".");
}

/** Negative when `left` is older than `right`, 0 when equal, positive when newer. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left) ?? [0, 0, 0];
  const b = parseVersion(right) ?? [0, 0, 0];

  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}
