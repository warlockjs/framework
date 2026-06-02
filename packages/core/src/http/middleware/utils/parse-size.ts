/**
 * Parse a human-readable size string into bytes.
 *
 * Accepts `"2mb"`, `"500kb"`, `"1.5gb"`, `"1024"`, `"1024b"`, etc. Case-insensitive.
 * Numeric input is returned untouched (already bytes).
 *
 * @example
 * parseSize("2mb");     // 2_097_152
 * parseSize("500kb");   // 512_000
 * parseSize(4096);      // 4096
 */
const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

export function parseSize(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid size value: ${value}`);
  }

  const [, amount, rawUnit = "b"] = match;
  const unit = rawUnit.toLowerCase();
  const multiplier = UNITS[unit];

  if (!multiplier) {
    throw new Error(`Unknown size unit: ${unit}`);
  }

  return Math.floor(Number(amount) * multiplier);
}
