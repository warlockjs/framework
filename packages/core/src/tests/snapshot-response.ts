/**
 * A response reduced to what a snapshot should pin: the status, the content
 * type and the body — with the values that differ on every run (ids, tokens,
 * timestamps) replaced, so the snapshot fails only when the shape or a stable
 * value changes.
 */
export type ResponseSnapshot = {
  status: number;
  contentType: string | null;
  body: unknown;
};

export type SnapshotResponseOptions = {
  /**
   * Dot paths whose values are replaced by `"[redacted]"`. `*` matches any
   * key or array index: `"post.id"`, `"posts.*.createdAt"`, `"*.token"`.
   */
  redact?: string[];
};

export const REDACTED = "[redacted]";

function redactPath(value: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return REDACTED;
  if (typeof value !== "object" || value === null) return value;

  const [head, ...rest] = segments;

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      head === "*" || head === String(index) ? redactPath(item, rest) : item,
    );
  }

  const record = value as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...record };

  for (const key of Object.keys(record)) {
    if (head === "*" || head === key) copy[key] = redactPath(record[key], rest);
  }

  return copy;
}

/**
 * Read a response into a {@link ResponseSnapshot} for `toMatchSnapshot()`.
 * Consumes the body: call it instead of `response.json()`, not after.
 *
 * @example
 * const response = await testPost("/posts", { title: "Hello" });
 *
 * expect(await snapshotResponse(response, { redact: ["post.id", "post.createdAt"] }))
 *   .toMatchSnapshot();
 */
export async function snapshotResponse(
  response: Response,
  options: SnapshotResponseOptions = {},
): Promise<ResponseSnapshot> {
  const contentType = response.headers.get("content-type");
  const text = await response.text();
  let body: unknown = text;

  if (contentType?.includes("json") && text !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  for (const path of options.redact ?? []) {
    body = redactPath(body, path.split("."));
  }

  return { status: response.status, contentType, body };
}
