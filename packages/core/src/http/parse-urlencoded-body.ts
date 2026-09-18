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
 */
export function parseUrlencodedBody(raw: string): Record<string, string | string[]> {
  const params = new URLSearchParams(raw);
  const body: Record<string, string | string[]> = {};

  for (const key of params.keys()) {
    if (Object.prototype.hasOwnProperty.call(body, key)) continue;

    const values = params.getAll(key);

    body[key] = values.length > 1 ? values : (values[0] ?? "");
  }

  return body;
}
