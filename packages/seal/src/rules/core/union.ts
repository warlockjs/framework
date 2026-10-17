import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule, ValidationResult } from "../../types";
import type { BaseValidator } from "../../validators/base-validator";

type MemberFailure = {
  /** Declaration order of the member, the last tie-breaker. */
  index: number;
  errors: ValidationResult["errors"];
  /** Mismatched literals: each says the value is a different member. */
  literalMismatches: number;
  /** Segments in the deepest error path (`a.b.c` → 3). */
  depth: number;
};

const describeFailure = (index: number, errors: ValidationResult["errors"]): MemberFailure => ({
  index,
  errors,
  literalMismatches: errors.filter((error) => error.type === "literal").length,
  depth: Math.max(0, ...errors.map((error) => (error.input ? error.input.split(".").length : 0))),
});

/**
 * Whether `candidate` is closer to the value than `best`:
 *
 * 1. Fewest mismatched literals. A literal that does not match (`kind: "owner"`
 *    given `"member"`) says the value is a different member, while any other
 *    error says it is this member with a bad field.
 * 2. Fewest errors.
 * 3. Deepest error: the member matched more of the value's structure.
 * 4. Declaration order (an earlier member wins a tie).
 */
const isCloser = (candidate: MemberFailure, best: MemberFailure): boolean => {
  if (candidate.literalMismatches !== best.literalMismatches) {
    return candidate.literalMismatches < best.literalMismatches;
  }

  if (candidate.errors.length !== best.errors.length) {
    return candidate.errors.length < best.errors.length;
  }

  if (candidate.depth !== best.depth) {
    return candidate.depth > best.depth;
  }

  return candidate.index < best.index;
};

/**
 * Union rule - value must match at least one of the provided validators.
 *
 * Every member whose type matches the value is tried, in order, until one
 * passes. When none passes, the errors of the closest failed member (see
 * `isCloser`) are reported at their own paths with the `union` type: its
 * first error under `firstErrorOnly` (the default), all of them otherwise.
 * A custom union error message replaces them with a single error, as does the
 * default message when no member matches the value's type.
 */
export const unionRule: SchemaRule<{ validators: BaseValidator[] }> = {
  name: "union",
  // Runs on "empty" values too: `v.union([v.literal(""), v.int()]).present()`
  // must still ask its members about `""` instead of accepting it unchecked.
  requiresValue: false,
  defaultErrorMessage: "Value must match one of the allowed types",
  async validate(value: any, context) {
    // Absence is the required/present rule's question, as for `literalRule`;
    // answering it here would defeat `.optional()`.
    if (value === undefined) {
      return VALID_RULE;
    }

    const validators = this.context.options.validators;
    const firstErrorOnly = context.configurations?.firstErrorOnly ?? true;
    let closest: MemberFailure | undefined;

    // `firstErrorOnly` limits the errors reported, never the members tried:
    // several object members all match a plain object, and a later one may
    // be the member the value belongs to.
    for (const [index, validator] of validators.entries()) {
      // A member that cannot hold this type of value cannot pass.
      if (!validator.matchesType(value)) {
        continue;
      }

      // Each member gets its own context: a member must not see what an
      // earlier member wrote into it (an object member sets `schema`).
      const result = await validator.validate(value, { ...context });

      if (result.isValid) {
        // Preserve defaults, computed fields and transformations from the branch.
        return { isValid: true, data: result.data };
      }

      const failure = describeFailure(
        index,
        result.errors?.length
          ? result.errors
          : [{ type: "union", error: "Validation failed", input: context.path }],
      );

      if (!closest || isCloser(failure, closest)) {
        closest = failure;
      }
    }

    const failed = invalidRule(this, context);

    // No member matched the type, or the union has its own message.
    if (!closest || this.context.errorMessage) {
      return failed;
    }

    const reported = firstErrorOnly ? closest.errors.slice(0, 1) : closest.errors;
    const errors = reported.map((error) => ({ error: error.error, path: error.input }));
    const first = errors[0];

    return first ? { ...failed, error: first.error, path: first.path, errors } : failed;
  },
};
