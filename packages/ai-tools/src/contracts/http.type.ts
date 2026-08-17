/**
 * Type contracts for `ai.tools.http` — a guarded HTTP/REST request tool.
 * Pure declarations only; the factory lives outside `contracts/`.
 */

/**
 * The HTTP methods `ai.tools.http` can be permitted to issue. The
 * default policy allows only `"GET"`; mutating methods are opt-in via
 * {@link HttpRequestOptions.allowMethods}.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Construction options for `ai.tools.http`. These bound what the model
 * is allowed to do — the model supplies the per-call URL / method /
 * body within these rails.
 */
export interface HttpRequestOptions {
  /**
   * Override the tool name exposed to the LLM.
   *
   * @default "http_request"
   */
  name?: string;
  /**
   * When set, the model passes a relative path that is resolved against
   * this base URL rather than supplying a full absolute URL.
   */
  baseUrl?: string;
  /**
   * Methods the tool is permitted to issue. A method the model requests
   * that is not on this list is rejected before the request.
   *
   * @default ["GET"]
   */
  allowMethods?: HttpMethod[];
  /**
   * Host allowlist, enforced before the request (an SSRF guardrail).
   * When set, any other host is rejected. Redirect targets are held to
   * the same allowlist.
   */
  allowHosts?: string[];
  /**
   * Permit requests to private / loopback / link-local / cloud-metadata
   * addresses. Off by default: the tool refuses internal targets (and
   * hostnames that resolve to them) even when `allowHosts` is unset, so
   * a prompt-injected URL cannot reach `169.254.169.254` or
   * `localhost`. Enable only for a tool that is meant to call an
   * internal service.
   *
   * @default false
   */
  allowPrivateNetwork?: boolean;
  /** Static headers merged into every call (e.g. an API key). */
  headers?: Record<string, string>;
  /**
   * Per-request timeout in milliseconds.
   *
   * @default 15_000
   */
  timeoutMs?: number;
  /**
   * Hard cap on response-body bytes before truncation.
   *
   * @default 1_000_000
   */
  maxBytes?: number;
}

/**
 * The validated input shape the model passes to `http_request`.
 */
export interface HttpRequestInput {
  /**
   * HTTP method. Must be one of {@link HttpRequestOptions.allowMethods}
   * (defaults to `"GET"` when omitted).
   */
  method?: HttpMethod;
  /**
   * Target URL — absolute, or a path resolved against
   * {@link HttpRequestOptions.baseUrl} when that is configured.
   */
  url: string;
  /** Per-call headers, merged over the static option headers. */
  headers?: Record<string, string>;
  /**
   * Request body. Serialized to JSON when an object is supplied; sent
   * as-is when a string. Ignored for methods that take no body.
   */
  body?: unknown;
}

/**
 * The `http_request` tool's output.
 */
export interface HttpRequestResult {
  /** HTTP status code of the response. */
  status: number;
  /** Response headers, lower-cased keys. */
  headers: Record<string, string>;
  /**
   * Parsed response body — a JSON value when the response content-type
   * is JSON, otherwise the raw response text.
   */
  body: unknown;
  /** True when the body was cut off at `maxBytes`. */
  truncated: boolean;
}
