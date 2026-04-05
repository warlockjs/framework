import { BaseValidator } from "./base-validator";
import { applyNullable } from "../standard-schema/json-schema";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";

/**
 * Any validator - accepts any value
 */
export class AnyValidator extends BaseValidator {
  /**
   * @inheritdoc
   *
   * Any validator accepts anything. In JSON Schema, an empty object `{}`
   * is the permissive schema that accepts any valid JSON value.
   *
   * @example
   * ```ts
   * v.any().toJsonSchema("draft-2020-12")
   * // → {}
   * ```
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    const schema: JsonSchemaResult = {};
    if (this.isNullable) applyNullable(schema, target);
    return schema;
  }
}
