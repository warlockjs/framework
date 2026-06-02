import { instanceofRule } from "../rules/common/instanceof";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import { BaseValidator } from "./base-validator";

/**
 * InstanceOf validator class
 *
 * Validates that the value is an instance of the given constructor (`value instanceof Ctor`).
 * Useful for File uploads, Buffer/Uint8Array payloads, and custom domain classes —
 * anywhere a runtime class identity is the right contract.
 *
 * Note: `Date` is already covered by `v.date()` with richer date-specific rules;
 * reach for `v.instanceof(Date)` only when you specifically want raw `instanceof`
 * semantics with no normalization.
 *
 * @example
 * v.instanceof(File)        // type: File
 * v.instanceof(Buffer)      // type: Buffer
 * v.instanceof(MyClass)     // type: MyClass
 */
export class InstanceOfValidator<T = unknown> extends BaseValidator {
  public ctor: new (...args: any[]) => T;

  public constructor(ctor: new (...args: any[]) => T, errorMessage?: string) {
    super();
    this.ctor = ctor;
    this.addMutableRule(instanceofRule, errorMessage, { ctor, name: ctor.name || "instance" });
  }

  /**
   * Check if value is an instance of the configured constructor
   */
  public matchesType(value: any): boolean {
    return value instanceof this.ctor;
  }

  /**
   * Clone the validator, preserving the target constructor.
   *
   * The base `clone()` only copies `BaseValidator` fields, so without this
   * override a cloned `instanceof` validator loses its `ctor` reference and
   * `matchesType()` would throw on the next call.
   */
  public override clone(): this {
    const cloned = super.clone();
    cloned.ctor = this.ctor;
    return cloned;
  }

  /**
   * @inheritdoc
   *
   * Class instances are not representable in JSON Schema — returns an empty
   * schema (permissive). Consumers serializing to OpenAPI should attach an
   * appropriate format manually if needed (e.g. `{ type: "string", format: "binary" }`
   * for `File`).
   */
  public override toJsonSchema(_target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    return {};
  }
}
