/**
 * Minimal, vendor-neutral [Standard Schema](https://standardschema.dev) v1
 * interface, declared locally so `@warlock.js/fs` takes **zero dependencies**
 * (not even a type-only one) to support schema-validated JSON reads.
 *
 * Any Standard-Schema-compliant validator satisfies this — `@warlock.js/seal`
 * (every seal validator is `& StandardSchemaV1`), zod, valibot, etc. — so
 * `fs.files.getJson(path, { schema })` is validator-agnostic and validates by
 * calling the schema's own `~standard.validate`, with no runtime import.
 */
export interface StandardSchemaV1<Output = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  };
}

/** A Standard Schema validation issue. */
export type StandardSchemaIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

/** Success carries the (possibly transformed) value; failure carries issues. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> };

/**
 * Thrown when a `getJson({ schema })` read fails Standard Schema validation.
 * Carries the raw issues so callers can inspect what failed.
 */
export class JsonSchemaValidationError extends Error {
  public constructor(
    public readonly path: string,
    public readonly issues: ReadonlyArray<StandardSchemaIssue>,
  ) {
    const summary = issues.map((issue) => issue.message).join("; ");
    super(`JSON at "${path}" failed schema validation: ${summary}`);
    this.name = "JsonSchemaValidationError";
  }
}

/**
 * Validate an already-parsed value against a Standard Schema. Awaits the
 * (possibly async) `~standard.validate`, returns the validated/transformed
 * value on success, and throws {@link JsonSchemaValidationError} on failure.
 *
 * @param path - Source path, for the error message.
 * @param schema - Any Standard Schema validator.
 * @param value - The parsed JSON value to validate.
 * @returns The validated (possibly transformed) value.
 */
export async function validateAgainstSchema<T>(
  path: string,
  schema: StandardSchemaV1<T>,
  value: unknown,
): Promise<T> {
  const result = await schema["~standard"].validate(value);

  if ("issues" in result && result.issues) {
    throw new JsonSchemaValidationError(path, result.issues);
  }

  return (result as { value: T }).value;
}
