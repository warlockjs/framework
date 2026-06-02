import { isPlainObject } from "@mongez/supportive-is";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import { applyNullable, wrapNullableStrict } from "../standard-schema/json-schema";
import type { SchemaContext, ValidationResult } from "../types";
import { BaseValidator } from "./base-validator";
import { LiteralValidator } from "./literal-validator";
import { ObjectValidator } from "./object-validator";

/**
 * Discriminated union validator — routes payloads by a shared discriminator field.
 *
 * Plain `v.union()` falls back to `matchesType()` to pick a branch, which is
 * coarse for object-vs-object unions (every branch matches "is plain object").
 * Discriminated union reads a known field's value and routes directly to the
 * matching branch, producing precise errors instead of confused mash from the
 * wrong branch.
 *
 * **Construction-time validation.** Every branch must:
 * - Be an `ObjectValidator`
 * - Declare the discriminator field
 * - Type the discriminator as `v.literal(...)` (single or multi-literal both work)
 * - Not collide with another branch's literal values
 *
 * Misconfigurations throw eagerly so tests catch them at schema-build time.
 *
 * @example
 * ```ts
 * const email = v.object({ type: v.literal("email"), email: v.string().email() });
 * const sms   = v.object({ type: v.literal("sms"),   phone: v.string() });
 * const push  = v.object({ type: v.literal("push"),  deviceId: v.string() });
 *
 * const notif = v.discriminatedUnion("type", [email, sms, push]);
 *
 * await validate(notif, { type: "sms", phone: "555-1234" });
 * // → routes to sms branch only; errors (if any) come from sms
 * ```
 *
 * @see `domains/seal/plans/2026-05-12-discriminated-union.md`
 */
export class DiscriminatedUnionValidator<
  K extends string = string,
  Branches extends ReadonlyArray<ObjectValidator<any>> = ReadonlyArray<ObjectValidator<any>>,
> extends BaseValidator {
  /** Map from discriminator literal value → matching branch validator. */
  private branches: Map<string | number | boolean, ObjectValidator<any>>;

  public constructor(
    public discriminator: K,
    public validators: Branches,
  ) {
    super();

    this.branches = DiscriminatedUnionValidator.buildBranchMap(discriminator, validators);
  }

  /**
   * Walk every branch, pull out the discriminator's literal values, and build
   * the lookup map. Throws on misconfiguration (missing discriminator,
   * non-literal discriminator, duplicate literal value).
   */
  private static buildBranchMap(
    discriminator: string,
    validators: ReadonlyArray<ObjectValidator<any>>,
  ): Map<string | number | boolean, ObjectValidator<any>> {
    const map = new Map<string | number | boolean, ObjectValidator<any>>();

    for (const branch of validators) {
      const discriminatorValidator = branch.schema?.[discriminator];

      if (!discriminatorValidator) {
        throw new Error(
          `[Seal] discriminatedUnion: branch missing discriminator field "${discriminator}"`,
        );
      }

      if (!(discriminatorValidator instanceof LiteralValidator)) {
        throw new Error(
          `[Seal] discriminatedUnion: discriminator "${discriminator}" must be v.literal(...) on every branch`,
        );
      }

      for (const value of discriminatorValidator.values) {
        if (map.has(value)) {
          throw new Error(
            `[Seal] discriminatedUnion: duplicate discriminator value "${String(value)}"`,
          );
        }
        map.set(value, branch);
      }
    }

    return map;
  }

  public override matchesType(value: any): boolean {
    return isPlainObject(value);
  }

  public override async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
    if (data === null && this.isNullable) {
      return { isValid: true, errors: [], data: null };
    }

    if (!isPlainObject(data)) {
      return {
        isValid: false,
        errors: [
          {
            type: "discriminatedUnion",
            error: `Expected object with discriminator field "${this.discriminator}"`,
            input: context.key || context.path || "value",
          },
        ],
        data: undefined,
      };
    }

    const discriminatorValue = data[this.discriminator];
    const branch = this.branches.get(discriminatorValue);

    if (!branch) {
      const allowed = [...this.branches.keys()].map((k) => String(k)).join(", ");
      return {
        isValid: false,
        errors: [
          {
            type: "discriminatedUnion",
            error: `Field "${this.discriminator}" must be one of: ${allowed}`,
            input: this.discriminator,
          },
        ],
        data: undefined,
      };
    }

    return branch.validate(data, context);
  }

  public override clone(): this {
    const cloned = super.clone() as any;
    cloned.discriminator = this.discriminator;
    cloned.validators = this.validators.map((v: ObjectValidator<any>) => v.clone());
    cloned.branches = DiscriminatedUnionValidator.buildBranchMap(
      cloned.discriminator,
      cloned.validators,
    );
    return cloned;
  }

  /**
   * Emit `oneOf` of branch schemas. Each branch's own `toJsonSchema()` handles
   * its `properties.{discriminator}.const` and the surrounding required/optional
   * structure — we just enumerate.
   *
   * For `openai-strict`: the per-branch ObjectValidator already inflates
   * `required` to include every field; `oneOf` is OpenAI-accepted as long as
   * each branch passes strict rules independently.
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    const oneOf = this.validators.map((v) => v.toJsonSchema(target));
    const schema: JsonSchemaResult = { oneOf };

    if (this.isNullable) {
      if (target === "openai-strict") {
        return wrapNullableStrict(schema);
      }
      applyNullable(schema, target);
    }

    return schema;
  }
}
