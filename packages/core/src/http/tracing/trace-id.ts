/**
 * W3C `traceparent` trace-id extraction.
 *
 * Format: `version-traceid-parentid-flags`, e.g.
 * `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`. Only version
 * `00` is accepted (later versions may change the field layout, and nothing
 * in this codebase needs to interoperate with one yet); the trace id must be
 * 32 hex characters and not all zero (the spec reserves all-zero as "no
 * trace"). Anything else is treated as absent, not as an error — a
 * malformed header must never fail the request.
 */
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const ALL_ZERO_TRACE_ID = "0".repeat(32);

/**
 * Extract the trace id from a raw `traceparent` header value, or `undefined`
 * when the header is missing, malformed, or carries the reserved all-zero id.
 */
export function parseTraceparentTraceId(header: string | undefined): string | undefined {
  if (!header) return undefined;

  const match = TRACEPARENT_PATTERN.exec(header.trim());

  if (!match) return undefined;

  const traceId = match[1];

  if (traceId === ALL_ZERO_TRACE_ID) return undefined;

  return traceId;
}

/**
 * Resolve the trace id to carry for a request: the inbound `traceparent`'s
 * trace id when valid, otherwise `requestId`.
 */
export function deriveTraceId(traceparentHeader: string | undefined, requestId: string): string {
  return parseTraceparentTraceId(traceparentHeader) ?? requestId;
}
