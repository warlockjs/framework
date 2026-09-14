import { ACCEPTED_VALUES } from "../rules/scalar/accepted-rule";
import { DECLINED_VALUES } from "../rules/scalar/declined-rule";
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

/**
 * Parse form-shaped boolean values into a real boolean, ahead of the type
 * rule.
 *
 * Opted into by calling any `accepted*`/`declined*` method on
 * `v.boolean()` (see `BooleanValidator`'s `withFormBooleanMutator`). Converts
 * every value in `ACCEPTED_VALUES` (`1`, `"1"`, `true`, `"true"`, `"yes"`,
 * `"y"`, `"on"`, `"Yes"`, `"Y"`, `"On"`) to `true`, and every value in
 * `DECLINED_VALUES` (`0`, `"0"`, `false`, `"false"`, `"no"`, `"n"`, `"off"`,
 * `"No"`, `"N"`, `"Off"`) to `false`. Any other value passes through
 * unchanged so the boolean type rule still rejects it.
 *
 * Named (not anonymous) so callers can detect whether it has already been
 * added — see the idempotence check in `BooleanValidator`.
 */
export const formBooleanMutator: Mutator = async (value) => {
  if (ACCEPTED_VALUES.includes(value)) {
    return true;
  }

  if (DECLINED_VALUES.includes(value)) {
    return false;
  }

  return value;
};
