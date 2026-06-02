import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import type { SchemaContext, ValidationResult } from "../types";
import { BaseValidator } from "./base-validator";

/**
 * Lazy validator — defers resolution of the inner validator until validate-time.
 *
 * Solves the chicken-and-egg of self-referencing schemas. JavaScript evaluates
 * an object literal before the `const` binding completes, so this can't work:
 *
 * ```ts
 * const categorySchema = v.object({
 *   name: v.string(),
 *   children: v.array(categorySchema),  // ❌ ReferenceError
 * });
 * ```
 *
 * Wrap the recursive reference in `v.lazy(() => …)` — the thunk isn't invoked
 * during construction, only when `validate()` is called:
 *
 * ```ts
 * type Category = { name: string; children: Category[] };
 *
 * const categorySchema: ObjectValidator<...> = v.object({
 *   name: v.string(),
 *   children: v.array(v.lazy(() => categorySchema)),
 * });
 *
 * type T = Infer<typeof categorySchema>;
 * // { name: string; children: T[] }   ← recursive type
 * ```
 *
 * The thunk is memoized — it's invoked once on the first validate (or
 * `matchesType` / `toJsonSchema`) call and the result is cached. The thunk is
 * expected to return a stable validator; calling it on every validate would be
 * wasteful and could mask bugs where the user accidentally returns a fresh
 * validator each time.
 *
 * **JSON Schema caveat.** v1 uses simple resolve-and-delegate — recursive
 * schemas will infinite-loop in `toJsonSchema()`. If you need JSON Schema for
 * a recursive shape, generate it manually with `$defs` + `$ref` until v2 lands.
 *
 * @see `domains/seal/plans/2026-05-12-lazy-validator.md`
 */
export class LazyValidator<T extends BaseValidator = BaseValidator> extends BaseValidator {
  private resolvedValidator: T | undefined;

  public constructor(private thunk: () => T) {
    super();
    // Lazy itself defers required handling to the inner validator —
    // mark the wrapper as optional so the required check doesn't fire here.
    this.requiredRule = null;
    this.isOptional = true;
  }

  /**
   * Resolve the inner validator. Memoizes the result so subsequent calls
   * don't re-execute the thunk.
   */
  private resolve(): T {
    if (this.resolvedValidator === undefined) {
      this.resolvedValidator = this.thunk();
    }

    return this.resolvedValidator;
  }

  public override async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
    return this.resolve().validate(data, context);
  }

  public override matchesType(value: any): boolean {
    return this.resolve().matchesType(value);
  }

  public override clone(): this {
    const cloned = super.clone();
    // Share the thunk reference; reset the memo so the clone resolves
    // independently on its first call (in case the thunk closure resolves
    // differently in a different context — unlikely but cheap insurance).
    cloned.thunk = this.thunk;
    cloned.resolvedValidator = undefined;

    return cloned;
  }

  /**
   * JSON Schema generation — simple resolve-and-delegate.
   *
   * **Recursive schemas will infinite-loop.** Until v2 adds `$ref` + `$defs`
   * generation, callers needing JSON Schema for recursive shapes must build
   * the schema manually.
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    return this.resolve().toJsonSchema(target);
  }
}
