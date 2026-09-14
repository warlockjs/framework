import type { Mutator } from "../types";

/**
 * Coerce a query-string-shaped boolean into a real boolean.
 *
 * Converts exactly: `"true"` / `"1"` / `1` → `true`, `"false"` / `"0"` / `0` → `false`.
 * Case-sensitive, no trimming. Any other value (`"yes"`, `"on"`, `"TRUE"`, `""`,
 * `2`, `null`, etc.) passes through unchanged so the boolean type rule rejects it.
 */
export const booleanCoerceMutator: Mutator = async (value) => {
  if (value === "true" || value === "1" || value === 1) {
    return true;
  }

  if (value === "false" || value === "0" || value === 0) {
    return false;
  }

  return value;
};
