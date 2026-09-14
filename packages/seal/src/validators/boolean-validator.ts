import { booleanCoerceMutator, formBooleanMutator } from "../mutators/boolean-mutators";
import {
  acceptedIfPresentRule,
  acceptedIfRequiredRule,
  acceptedIfRule,
  acceptedRule,
  acceptedUnlessRule,
  acceptedWithoutRule,
  declinedIfPresentRule,
  declinedIfRequiredRule,
  declinedIfRule,
  declinedRule,
  declinedUnlessRule,
  declinedWithoutRule,
} from "../rules/scalar";
import { booleanRule } from "../rules";
import { PrimitiveValidator } from "./primitive-validator";
import { applyNullable } from "../standard-schema/json-schema";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import type { SchemaRule, SchemaRuleOptions } from "../types";

/**
 * Boolean validator class
 *
 * Extends PrimitiveValidator — inherits enum/in/oneOf/allowsOnly/forbids/notIn.
 * Defines accepted/declined directly as real methods (not ScalarValidator field copies)
 * so they survive cloning correctly.
 */
export class BooleanValidator extends PrimitiveValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addMutableRule(booleanRule, errorMessage);
  }

  /**
   * Check if value is a boolean type
   */
  public matchesType(value: any): boolean {
    return typeof value === "boolean";
  }

  /**
   * Add a rule from the accepted/declined family, opting the validator into
   * form-boolean parsing.
   *
   * Calling ANY `accepted*`/`declined*` method on `v.boolean()` adds (once,
   * idempotently — checked by mutator identity so chaining several of these
   * methods never stacks duplicates) `formBooleanMutator`, which runs before
   * the type rule and converts the accepted set (`1`, `"1"`, `true`,
   * `"true"`, `"yes"`, `"y"`, `"on"`, `"Yes"`, `"Y"`, `"On"`) to `true` and
   * the declined set (`0`, `"0"`, `false`, `"false"`, `"no"`, `"n"`, `"off"`,
   * `"No"`, `"N"`, `"Off"`) to `false`; any other value passes through
   * unchanged and is rejected by the strict type rule as before.
   *
   * The mutator and the rule are added to the SAME resolved instance in one
   * pass — resolving `this.instance` twice (once per `addRule`/`addMutator`
   * call) would clone twice on an immutable validator and silently drop one
   * of the two additions.
   */
  private addFormBooleanRule<T extends SchemaRuleOptions = SchemaRuleOptions>(
    rule: SchemaRule<T>,
    errorMessage?: string,
    options: T = {} as T,
  ): this {
    const instance = this.instance;

    if (!instance.mutators.some((mutator) => mutator.mutate === formBooleanMutator)) {
      instance.addMutableMutator(formBooleanMutator);
    }

    instance.addMutableRule(rule, errorMessage, options);

    return instance;
  }

  // ==================== Accepted ====================

  /** Value must be accepted (true, "yes", 1, "on", etc. — form strings are parsed into a real boolean first) */
  public accepted(errorMessage?: string) {
    return this.addFormBooleanRule(acceptedRule, errorMessage);
  }

  /** Value must be accepted if another field equals a value */
  public acceptedIf(field: string, value: any, errorMessage?: string) {
    return this.addFormBooleanRule(acceptedIfRule, errorMessage, { field, value });
  }

  /** Value must be accepted unless another field equals a value */
  public acceptedUnless(field: string, value: any, errorMessage?: string) {
    return this.addFormBooleanRule(acceptedUnlessRule, errorMessage, { field, value });
  }

  /** Value must be accepted if another field is required */
  public acceptedIfRequired(field: string, errorMessage?: string) {
    return this.addFormBooleanRule(acceptedIfRequiredRule, errorMessage, { field });
  }

  /** Value must be accepted if another field is present */
  public acceptedIfPresent(field: string, errorMessage?: string) {
    return this.addFormBooleanRule(acceptedIfPresentRule, errorMessage, { field });
  }

  /** Value must be accepted if another field is missing */
  public acceptedWithout(field: string, errorMessage?: string) {
    return this.addFormBooleanRule(acceptedWithoutRule, errorMessage, { field });
  }

  // ==================== Declined ====================

  /** Value must be declined (false, "no", 0, "off", etc. — form strings are parsed into a real boolean first) */
  public declined(errorMessage?: string) {
    return this.addFormBooleanRule(declinedRule, errorMessage);
  }

  /** Value must be declined if another field equals a value */
  public declinedIf(field: string, value: any, errorMessage?: string) {
    return this.addFormBooleanRule(declinedIfRule, errorMessage, { field, value });
  }

  /** Value must be declined unless another field equals a value */
  public declinedUnless(field: string, value: any, errorMessage?: string) {
    return this.addFormBooleanRule(declinedUnlessRule, errorMessage, { field, value });
  }

  /** Value must be declined if another field is required */
  public declinedIfRequired(field: string, errorMessage?: string) {
    return this.addFormBooleanRule(declinedIfRequiredRule, errorMessage, { field });
  }

  /** Value must be declined if another field is present */
  public declinedIfPresent(field: string, errorMessage?: string) {
    return this.addFormBooleanRule(declinedIfPresentRule, errorMessage, { field });
  }

  /** Value must be declined if another field is missing */
  public declinedWithout(field: string, errorMessage?: string) {
    return this.addFormBooleanRule(declinedWithoutRule, errorMessage, { field });
  }

  // ==================== Coercion ====================

  /**
   * Opt in to coercion: an exact query-string-shaped boolean is converted to a
   * real boolean **before** the type rules run; any other value passes through
   * unchanged so bad input still fails the type rule.
   *
   * Converts exactly `"true"` / `"1"` / `1` → `true` and `"false"` / `"0"` / `0`
   * → `false`. Case-sensitive, no trimming — `"TRUE"`, `"yes"`, `"on"`, `""`, and
   * `2` all pass through unchanged and fail the type rule. `v.boolean()` does
   * **not** coerce by default; this only takes effect when explicitly chained.
   * For form-style truthy strings like `"yes"` / `"on"`, use `.accepted()` /
   * `.declined()` instead — those methods opt into their own form-boolean
   * parsing (a wider value set, case-insensitive on a few forms) and then
   * apply the accepted/declined pass-fail rule on top of the parsed boolean.
   *
   * The output type is unchanged (`Infer<>` keys off the validator class), so
   * `v.boolean().coerce()` still infers `boolean`.
   *
   * @example
   * v.boolean().coerce()   // "true" → true; "1" → true; "0" → false; "yes" → invalid
   */
  public coerce() {
    return this.addMutator(booleanCoerceMutator) as this & { isCoerced: true };
  }

  // ==================== Strict boolean checks ====================

  /**
   * Value must be strictly true (not "yes", "on", 1, etc.)
   * @alias accepted - strict version
   */
  public mustBeTrue(errorMessage?: string) {
    return this.equal(true, errorMessage);
  }

  /**
   * Value must be strictly false (not "no", "off", 0, etc.)
   * @alias declined - strict version
   */
  public mustBeFalse(errorMessage?: string) {
    return this.equal(false, errorMessage);
  }

  /**
   * @inheritdoc
   *
   * @note accepted/declined rules and all cross-field boolean rules
   * are not representable in JSON Schema and are silently omitted.
   *
   * @example
   * ```ts
   * v.boolean().toJsonSchema("draft-2020-12")
   * // → { type: "boolean" }
   *
   * v.boolean().nullable().toJsonSchema("openapi-3.0")
   * // → { type: "boolean", nullable: true }
   * ```
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    const schema: JsonSchemaResult = { type: "boolean" };
    if (this.isNullable) applyNullable(schema, target);
    return schema;
  }
}
