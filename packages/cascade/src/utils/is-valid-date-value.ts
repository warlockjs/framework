// Strings must carry a time part AND a timezone (Z or ±hh:mm), so plain text such as
// "2024-01-15" or a zone-less local datetime is never turned into a Date.
const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Check if the given value is a valid date value
 */
export function isValidDateValue(value: unknown): boolean {
  // ✅ Handle timestamps
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;

    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  }

  // ❌ Only allow strict ISO strings
  if (typeof value !== "string") return false;

  if (!isoRegex.test(value)) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  // 🔥 Critical step: prevent JS auto-correction
  // Example: "2023-02-31" → March 3 (WRONG but "valid")
  // Checked on the written date part itself, so a timezone offset can't shift it.
  const datePart = value.split("T")[0];
  if (datePart === undefined) return false;

  const [y, m, d] = datePart.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;

  const written = new Date(Date.UTC(y, m - 1, d));

  return written.getUTCFullYear() === y && written.getUTCMonth() + 1 === m && written.getUTCDate() === d;
}
