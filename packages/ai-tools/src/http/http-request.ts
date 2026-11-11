import { guardedFetch, OutboundPolicyError, tool, type ToolContract } from "@warlock.js/ai";
import type {
  HttpMethod,
  HttpRequestInput,
  HttpRequestOptions,
  HttpRequestResult,
} from "../contracts";
import { createDeadline, type CallDeadline } from "../deadline";
import { HttpPolicyError } from "../errors";
import {
  objectSchema,
  optionalStringEnumField,
  optionalStringRecordField,
  passthroughField,
  stringField,
} from "../schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "http_request";

/** Default per-request wall-clock timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Default hard cap on response-body bytes before truncation. */
const DEFAULT_MAX_BYTES = 1_000_000;

/** The full set of HTTP methods, in the order they appear in {@link HttpMethod}. */
const ALL_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Methods that conventionally carry no request body — `body` is dropped for these. */
const BODYLESS_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(["GET"]);

/** Maximum number of redirect hops followed (each one re-validated). */
const MAX_REDIRECTS = 5;

/** 3xx statuses whose `Location` is followed. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Credential headers never sent to a redirect target on another origin. */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

/**
 * Standard Schema for {@link HttpRequestInput}. `url` is required;
 * `method` is constrained to the canonical HTTP verb set (further
 * narrowed to the tool's `allowMethods` at runtime); `headers` is an
 * optional string-to-string record; `body` is an opaque passthrough the
 * handler serializes based on its runtime type.
 */
const httpRequestInputSchema = objectSchema<HttpRequestInput>({
  method: optionalStringEnumField<HttpMethod>(ALL_METHODS),
  url: stringField(),
  headers: optionalStringRecordField(),
  body: passthroughField(),
});

/**
 * Resolve the request target. With a `baseUrl` configured the model
 * supplies a path joined against it; otherwise the model's `url` must be
 * an absolute `http(s)` URL. Throws a typed {@link HttpPolicyError} of
 * type `"invalid-url"` when the result cannot be parsed or is not an
 * `http`/`https` URL — surfaced as `{ error }` data, never a crash.
 *
 * With a `baseUrl`, the resolved URL must stay on the base URL's origin:
 * an absolute (`https://other.example/x`) or protocol-relative
 * (`//other.example/x`) value that points elsewhere is refused with type
 * `"host-not-allowed"`, unless its host is listed in `allowHosts`. This
 * keeps the static `headers` (an API key) from being sent to a host the
 * model names.
 */
function resolveUrl(
  rawUrl: string,
  baseUrl: string | undefined,
  allowHostSet: ReadonlySet<string> | undefined,
): URL {
  let resolved: URL;

  try {
    // `new URL(input, base)` joins relative paths against `base` and
    // ignores `base` when `input` is already absolute; the origin check
    // below holds the result to the base URL's origin.
    resolved = baseUrl !== undefined ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
  } catch {
    throw new HttpPolicyError(
      `http_request could not resolve a valid URL from "${rawUrl}"` +
        (baseUrl !== undefined ? ` against base "${baseUrl}".` : "."),
      { type: "invalid-url" },
    );
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new HttpPolicyError(
      `http_request only permits http(s) URLs; got "${resolved.protocol}".`,
      { type: "invalid-url" },
    );
  }

  if (baseUrl !== undefined) {
    const baseOrigin = new URL(baseUrl).origin;

    if (resolved.origin !== baseOrigin && !allowHostSet?.has(resolved.hostname)) {
      throw new HttpPolicyError(
        `http_request only sends requests to the base URL origin "${baseOrigin}"; ` +
          `"${rawUrl}" points to "${resolved.origin}". Pass a path relative to the base URL, ` +
          `or list the host in the tool's allowHosts option.`,
        { type: "host-not-allowed" },
      );
    }
  }

  return resolved;
}

/** The base URL's host as a one-entry allowlist; `undefined` without a valid `baseUrl`. */
function baseHostAllowlist(baseUrl: string | undefined): string[] | undefined {
  if (baseUrl === undefined) {
    return undefined;
  }

  try {
    return [new URL(baseUrl).hostname];
  } catch {
    // An unparseable base URL fails every call with "invalid-url" instead.
    return undefined;
  }
}

/**
 * Read a `Response` body, capping at `maxBytes`. Returns the decoded text
 * and whether it was cut off. Streams chunk-by-chunk so an oversized body
 * is abandoned at the cap rather than fully buffered; falls back to
 * `response.text()` (then a post-hoc byte slice) when the body is not a
 * readable stream (e.g. a stubbed `Response` in tests). Every read is
 * raced against the call's `deadline`, so a server that drips its body
 * cannot hold the call open past `timeoutMs`.
 */
async function readCappedBody(
  response: Response,
  maxBytes: number,
  deadline: CallDeadline,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;

  if (!body) {
    return { text: "", truncated: false };
  }

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let received = 0;
  let truncated = false;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      const remaining = maxBytes - received;

      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        received = maxBytes;
        truncated = true;
        break;
      }

      text += decoder.decode(value, { stream: true });
      received += value.byteLength;
    }
  } finally {
    // Abandon any unread remainder without waiting on a stalled stream.
    reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  text += decoder.decode();

  return { text, truncated };
}

/**
 * Decide whether a response's `content-type` indicates JSON. Matches
 * `application/json` and the `+json` structured-suffix convention
 * (e.g. `application/vnd.api+json`), case-insensitively.
 */
function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const value = contentType.toLowerCase();

  return value.includes("application/json") || value.includes("+json");
}

/**
 * Build the agent-facing `http_request` tool — a guarded HTTP/REST client
 * over the global `fetch`. The `options` bound what the model may do; the
 * model supplies the per-call URL / method / headers / body within those
 * rails.
 *
 * **Guardrails (all enforced before the network call).**
 * - **Method allowlist** — `allowMethods` (default `["GET"]`). A method
 *   outside the list is rejected with a typed
 *   {@link HttpPolicyError} (`type: "method-not-allowed"`).
 * - **Private-network deny (default).** The request — and every redirect
 *   hop — goes through the framework's `guardedFetch` outbound policy,
 *   which refuses private / loopback / link-local / cloud-metadata
 *   addresses (and hostnames resolving to them) unless
 *   `allowPrivateNetwork: true` is set. This applies even when
 *   `allowHosts` is not configured, so a bare `ai.tools.http()` is not
 *   an SSRF primitive (`type: "host-not-allowed"`).
 * - **Host allowlist** — when `allowHosts` is set, any other host is
 *   rejected (`type: "host-not-allowed"`), an SSRF guardrail; redirect
 *   targets are held to the same allowlist.
 * - **`baseUrl` join** — when configured, the model passes a path that
 *   is resolved against `baseUrl`; otherwise it must pass an absolute
 *   `http(s)` URL. An unresolvable URL is rejected
 *   (`type: "invalid-url"`). With `baseUrl` set, a URL on another origin
 *   is refused (`type: "host-not-allowed"`) unless its host is listed in
 *   `allowHosts`, and redirects stay on the base host.
 *
 * **Request shaping.** Static `options.headers` are merged under the
 * per-call `headers` (the per-call value wins). They are sent only to the
 * origin of the first request: a redirect to another origin drops every
 * static header (and `authorization` / `cookie` / `proxy-authorization`).
 * An object `body` is JSON-serialized with a `content-type:
 * application/json` default; a string `body` is sent verbatim; `body` is
 * dropped for bodyless methods (`GET`). The whole call — connect,
 * redirects and reading the body — is bounded by `timeoutMs` (default
 * `15_000`, `type: "timeout"`), and `ctx.signal` aborts it.
 *
 * **Response shaping.** Headers are returned with lower-cased keys. The
 * body is read up to `maxBytes` (default `1_000_000`) and JSON-parsed
 * when the response `content-type` is JSON, otherwise returned as text;
 * `truncated` is `true` when the body was cut off at the cap (a truncated
 * JSON body is returned as the raw partial string, since it can no longer
 * be parsed).
 *
 * **Errors flow as data.** Every guardrail rejection and network failure
 * is thrown inside `execute`; the framework's `tool()` wrapper catches it
 * and surfaces it in the returned `{ error }` field, so the agent reads
 * the failure and self-corrects rather than crashing.
 *
 * @param options - Construction-time policy bounding the tool.
 * @returns A {@link ToolContract} the agent can call as `http_request`.
 *
 * @example
 * const stripe = httpRequestTool({
 *   baseUrl: "https://api.stripe.com",
 *   allowHosts: ["api.stripe.com"],
 *   allowMethods: ["GET", "POST"],
 *   headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` },
 * });
 * const { data } = await stripe.invoke({ method: "GET", url: "/v1/charges" });
 */
export function httpRequestTool(
  options: HttpRequestOptions = {},
): ToolContract<HttpRequestInput, HttpRequestResult> {
  const allowMethods = options.allowMethods ?? ["GET"];
  const allowedMethodSet = new Set<HttpMethod>(allowMethods);
  const allowHostSet = options.allowHosts ? new Set(options.allowHosts) : undefined;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const staticHeaders = options.headers ?? {};
  const staticHeaderNames = new Set(Object.keys(staticHeaders).map((key) => key.toLowerCase()));
  // Without an explicit allowlist, a `baseUrl` tool's redirects stay on the base host.
  const hostAllowlist = options.allowHosts ?? baseHostAllowlist(options.baseUrl);

  return tool<HttpRequestInput, HttpRequestResult>({
    name: options.name ?? DEFAULT_NAME,
    description:
      "Issue an HTTP request and return the status, response headers, and " +
      "parsed body. Allowed methods and hosts are restricted by the tool's " +
      "configuration; a request outside those rails is rejected before any " +
      "network call. Pass an object body to send JSON, or a string to send " +
      "it verbatim. The response body is JSON-parsed when the content-type " +
      "is JSON, otherwise returned as text, and is capped — `truncated` is " +
      "true when the body was cut off.",
    action: (input) => `Requesting ${input.method ?? "GET"} ${input.url}`,
    input: httpRequestInputSchema,
    async execute(input, ctx) {
      const method: HttpMethod = input.method ?? "GET";

      // 1. Method allowlist — rejected before anything else.
      if (!allowedMethodSet.has(method)) {
        throw new HttpPolicyError(
          `http_request method "${method}" is not allowed. ` +
            `Permitted methods: ${[...allowedMethodSet].join(", ")}.`,
          { type: "method-not-allowed" },
        );
      }

      // 2. URL resolution (baseUrl join when configured).
      const url = resolveUrl(input.url, options.baseUrl, allowHostSet);

      // 3. Host allowlist — SSRF guardrail, before the fetch.
      if (allowHostSet && !allowHostSet.has(url.hostname)) {
        throw new HttpPolicyError(
          `http_request host "${url.hostname}" is not in the allowlist. ` +
            `Permitted hosts: ${[...allowHostSet].join(", ")}.`,
          { type: "host-not-allowed" },
        );
      }

      // 4. Merge headers — static option headers under the per-call ones,
      //    so a per-call header overrides a static default of the same name.
      const headers: Record<string, string> = { ...staticHeaders, ...input.headers };

      // 5. Shape the body. Dropped for bodyless methods; objects become
      //    JSON (with a default content-type); strings are sent verbatim.
      let body: string | undefined;

      if (!BODYLESS_METHODS.has(method) && input.body !== undefined) {
        if (typeof input.body === "string") {
          body = input.body;
        } else {
          body = JSON.stringify(input.body);

          const hasContentType = Object.keys(headers).some(
            (key) => key.toLowerCase() === "content-type",
          );

          if (!hasContentType) {
            headers["content-type"] = "application/json";
          }
        }
      }

      // 6. Issue the request through the shared hardened outbound path:
      //    private-IP deny by default, per-hop redirect re-validation and
      //    the caller's signal — never a raw fetch. Redirects are followed
      //    here so the static headers stay on the first request's origin.
      //    One deadline covers every hop and the body read below.
      const timeoutError = (): HttpPolicyError =>
        new HttpPolicyError(
          `http_request timed out after ${timeoutMs}ms before the response was complete. ` +
            `Raise the tool's timeoutMs option if this endpoint is slow.`,
          { type: "timeout" },
        );
      const deadline = createDeadline(timeoutMs, ctx?.signal, timeoutError);

      // Headers for a hop on another origin: no static header and no credential.
      const offOriginHeaders: Record<string, string> = {};

      for (const [key, value] of Object.entries(headers)) {
        const name = key.toLowerCase();

        if (!staticHeaderNames.has(name) && !CREDENTIAL_HEADERS.has(name)) {
          offOriginHeaders[key] = value;
        }
      }

      const send = async (hopUrl: URL, hopMethod: string, hopBody?: string): Promise<Response> => {
        try {
          return await guardedFetch(
            hopUrl.toString(),
            {
              allowedSchemes: ["http", "https"],
              hostAllowlist,
              denyPrivateIPsAfterDNS: !allowPrivateNetwork,
              timeoutMs,
              signal: deadline.signal,
            },
            {
              method: hopMethod,
              headers: hopUrl.origin === url.origin ? headers : offOriginHeaders,
              body: hopBody,
              redirect: "manual",
            },
          );
        } catch (cause) {
          if (deadline.timedOut) {
            throw deadline.signal.reason;
          }

          if (cause instanceof OutboundPolicyError) {
            throw new HttpPolicyError(`http_request blocked: ${cause.message}`, {
              type: "host-not-allowed",
              cause,
            });
          }

          throw cause;
        }
      };

      try {
        let hopUrl = url;
        let hopMethod: string = method;
        let hopBody = body;

        for (let hop = 0; ; hop++) {
          const response = await send(hopUrl, hopMethod, hopBody);
          const location = response.headers.get("location");

          if (!REDIRECT_STATUSES.has(response.status) || location === null) {
            return await readResult(response, maxBytes, deadline).catch((cause: unknown) => {
              // The outbound guard aborts a body still streaming at its own deadline.
              throw deadline.timedOut || cause instanceof OutboundPolicyError
                ? timeoutError()
                : cause;
            });
          }

          if (hop >= MAX_REDIRECTS) {
            throw new HttpPolicyError(
              `http_request blocked: more than ${MAX_REDIRECTS} redirects starting at "${url.toString()}".`,
              { type: "host-not-allowed" },
            );
          }

          let next: URL;

          try {
            next = new URL(location, hopUrl);
          } catch {
            throw new HttpPolicyError(
              `http_request received an invalid redirect location "${location}".`,
              { type: "invalid-url" },
            );
          }

          // Discard the interim body so the connection can be reused.
          response.body?.cancel().catch(() => undefined);

          // 303 — and 301/302 on a non-GET — re-issue as a bodyless GET.
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && hopMethod !== "GET")
          ) {
            hopMethod = "GET";
            hopBody = undefined;
          }

          hopUrl = next;
        }
      } finally {
        deadline.clear();
      }
    },
  });
}

/**
 * Shape the final response: lower-cased headers, then the body read up
 * to `maxBytes` (within the call's deadline) and JSON-parsed when the
 * content-type is JSON.
 */
async function readResult(
  response: Response,
  maxBytes: number,
  deadline: CallDeadline,
): Promise<HttpRequestResult> {
  // 7. Collect response headers with lower-cased keys.
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  // 8. Read the body up to the cap, then parse-or-pass.
  const { text, truncated } = await readCappedBody(response, maxBytes, deadline);

  let parsedBody: unknown = text;

  // A truncated body can no longer be valid JSON, so only attempt a
  // parse on a complete JSON response; otherwise hand back the raw text.
  if (!truncated && isJsonContentType(responseHeaders["content-type"]) && text.length > 0) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      // Content-type claimed JSON but the body was not — fall back to
      // the raw text rather than failing the whole call.
      parsedBody = text;
    }
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body: parsedBody,
    truncated,
  };
}
