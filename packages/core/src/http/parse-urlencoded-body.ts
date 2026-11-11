import { HttpErrorCodes } from "./error-codes";
import { createRequestRefusal } from "./request-refusal";

/** Default for `http.urlencoded.maxFields`. */
export const DEFAULT_URLENCODED_MAX_FIELDS = 1000;

export type ParseUrlencodedBodyOptions = {
  /**
   * Most fields (counting repeats of the same key) one body may carry; more
   * answers 413. A non-positive or non-integer value falls back to the default.
   *
   * @default 1000
   */
  maxFields?: number;
};

/**
 * Decode an `application/x-www-form-urlencoded` request body into a plain
 * object, the shape `request.ts`'s `parseBody` already expects from JSON and
 * multipart bodies.
 *
 * Repeated keys become arrays (`code=a&code=b` -> `{ code: ["a", "b"] }`);
 * every other key stays a single string. Bracket-notation keys (`a[b]=1`) are
 * NOT expanded here — they are handed through as literal keys and, like any
 * JSON or query-string key of that shape, are expanded later by the shared
 * `parseBody` nesting logic in `request.ts`. This function's only job is the
 * urlencoded -> flat-object step; it does not duplicate that logic.
 *
 * One pass over the pairs: looking every key up again with `getAll()` made
 * the work grow with the square of the field count, so a body of a few
 * thousand distinct keys could hold the event loop for seconds.
 */
export function parseUrlencodedBody(
  raw: string,
  options: ParseUrlencodedBodyOptions = {},
): Record<string, string | string[]> {
  const maxFields = resolveMaxFields(options.maxFields);
  const params = new URLSearchParams(raw);
  const values = new Map<string, string[]>();
  let fields = 0;

  for (const [key, value] of params) {
    fields++;

    if (fields > maxFields) {
      throw createRequestRefusal(
        413,
        HttpErrorCodes.TooManyFormFields,
        `The form has more than ${maxFields} fields. Send fewer fields, or raise http.urlencoded.maxFields.`,
      );
    }

    const existing = values.get(key);

    if (existing) {
      existing.push(value);
    } else {
      values.set(key, [value]);
    }
  }

  const body: Record<string, string | string[]> = {};

  for (const [key, list] of values) {
    // a `__proto__` key would replace the object's prototype; request parsing
    // drops that segment anyway
    if (key === "__proto__") continue;

    body[key] = list.length > 1 ? list : (list[0] ?? "");
  }

  return body;
}

function resolveMaxFields(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_URLENCODED_MAX_FIELDS;
}
