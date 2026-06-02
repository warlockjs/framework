import { literalRule } from "../rules/common/literal";
import { applyNullable } from "../standard-schema/json-schema";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import { BaseValidator } from "./base-validator";

/**
 * Literal validator class
 *
 * Accepts a fixed tuple of primitive literal values (string, number, boolean).
 * The TypeScript type narrows to the union of those literals — `v.literal("a", "b")`
 * infers as `"a" | "b"`, not `string`. Use for discriminator fields, enum-like
 * unions of constants, and any case where `oneOf([...])` would lose literal types.
 *
 * @example
 * v.literal("items")               // type: "items"
 * v.literal("draft", "published")  // type: "draft" | "published"
 * v.literal(1, 2, 3)               // type: 1 | 2 | 3
 * v.literal(true)                  // type: true
 */
export class LiteralValidator<
  T extends readonly (string | number | boolean)[] = readonly (string | number | boolean)[],
> extends BaseValidator {
  public values: T;

  public constructor(values: T, errorMessage?: string) {
    super();
    this.values = values;
    this.addMutableRule(literalRule, errorMessage, { values });
  }

  /**
   * Check if value is one of the configured literals
   */
  public matchesType(value: any): boolean {
    return (this.values as readonly any[]).includes(value);
  }

  /**
   * Clone the validator, preserving the literal `values` set.
   *
   * The base `clone()` only copies `BaseValidator` fields, so without this
   * override a cloned literal loses its public `values` array — which breaks
   * any consumer that reads it (e.g. `discriminatedUnion` branch routing).
   */
  public override clone(): this {
    const cloned = super.clone();
    cloned.values = this.values;
    return cloned;
  }

  /**
   * @inheritdoc
   *
   * Single literal → `{ const: <value> }`. Multiple → `{ enum: [...] }`.
   *
   * @example
   * ```ts
   * v.literal("items").toJsonSchema()
   * // → { const: "items" }
   *
   * v.literal("draft", "published").toJsonSchema()
   * // → { enum: ["draft", "published"] }
   * ```
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    const schema: JsonSchemaResult =
      this.values.length === 1 ? { const: this.values[0] } : { enum: [...this.values] };
    if (this.isNullable) applyNullable(schema, target);
    return schema;
  }
}
