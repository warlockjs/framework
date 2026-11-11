import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateOrReservedIp } from "@warlock.js/core/net";
import { OutboundPolicyError } from "../errors";
import type { OutboundPolicy, ResolvedOutboundPolicy } from "./outbound-policy.type";

/** 5 MiB — default cap on an outbound response body. */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** 10s — default per-request timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Default cap on the number of policy-validated redirect hops. */
const DEFAULT_MAX_REDIRECTS = 5;

/** 3xx statuses whose `Location` a follow re-issues. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Request headers that carry no credential and still travel when a redirect
 * moves to another origin. Every other caller-supplied header (an
 * `authorization`, a cookie, or a custom secret such as `x-api-key`) is
 * dropped on that hop unless the policy lists it in `crossOriginHeaders`.
 */
const CROSS_ORIGIN_SAFE_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-language",
  "content-type",
  "pragma",
  "user-agent",
]);

/**
 * Key under which the runtime's `fetch` keeps its process-wide dispatcher.
 * The pinned dispatcher is built from the same class, so it speaks the
 * protocol the global `fetch` expects without a separate HTTP client.
 */
const GLOBAL_DISPATCHER_KEY = Symbol.for("undici.globalDispatcher.1");

/**
 * The runtime's `fetch` as it was when this module loaded — used only to
 * make the runtime create its default dispatcher, so a `fetch` replaced
 * later (a test stub, an instrumentation wrapper) never sees that call.
 */
const runtimeFetch: typeof fetch | undefined = globalThis.fetch;

/**
 * Deadline state of a response returned by {@link guardedFetch}: the
 * signal that fires at `timeoutMs` and the hook that clears the timer.
 * {@link readTextCapped} reads it so the body read stays inside the same
 * deadline as the request.
 */
type ResponseDeadline = { signal: AbortSignal; release: () => void };

const responseDeadlines = new WeakMap<Response, ResponseDeadline>();

/**
 * Fill an {@link OutboundPolicy} with strict defaults: https-only,
 * private-IP deny on, 10s timeout, 5 MiB cap, global `fetch`. Idempotent
 * — resolving an already-resolved policy yields the same shape.
 */
export function resolveOutboundPolicy(policy: OutboundPolicy = {}): ResolvedOutboundPolicy {
  return {
    allowedSchemes: policy.allowedSchemes ?? ["https"],
    hostAllowlist: policy.hostAllowlist,
    denyPrivateIPsAfterDNS: policy.denyPrivateIPsAfterDNS ?? true,
    maxBytes: policy.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: policy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRedirects: policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    crossOriginHeaders: policy.crossOriginHeaders ?? [],
    signal: policy.signal,
    fetch: policy.fetch ?? globalThis.fetch,
  };
}

/** Strip the `[ ]` IPv6 brackets `URL.hostname` keeps. */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Whether `host` equals or is a subdomain of any allowlist entry. */
function hostAllowed(host: string, allowlist: string[]): boolean {
  const lower = host.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.toLowerCase();
    return lower === e || lower.endsWith(`.${e}`);
  });
}

/**
 * Validate a URL against the policy BEFORE any network call: scheme
 * allowlist, host allowlist, and (when enabled) a DNS resolution that
 * rejects private / loopback / link-local / metadata addresses — the SSRF
 * guard. Returns the parsed `URL` on success; throws
 * {@link OutboundPolicyError} otherwise.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  policy: ResolvedOutboundPolicy,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundPolicyError(`outbound request blocked — invalid URL: ${rawUrl}`, {
      context: { url: rawUrl },
    });
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (!policy.allowedSchemes.some((s) => s.toLowerCase() === scheme)) {
    throw new OutboundPolicyError(
      `outbound request blocked — scheme "${scheme}" is not allowed (allowed: ${policy.allowedSchemes.join(", ")})`,
      { context: { url: rawUrl, scheme } },
    );
  }

  const host = stripBrackets(url.hostname);

  if (policy.hostAllowlist && !hostAllowed(host, policy.hostAllowlist)) {
    throw new OutboundPolicyError(
      `outbound request blocked — host "${host}" is not in the allowlist`,
      { context: { url: rawUrl, host } },
    );
  }

  if (policy.denyPrivateIPsAfterDNS) {
    await assertHostNotPrivate(host, rawUrl);
  }

  return url;
}

/**
 * Reject when `host` is — or resolves to — a private / reserved address.
 * IP literals are checked directly; hostnames are resolved via DNS and
 * every returned address is checked (a public name pointing inward is
 * caught). A resolution failure fails closed.
 */
async function assertHostNotPrivate(host: string, rawUrl: string): Promise<void> {
  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new OutboundPolicyError(
        `outbound request blocked — "${host}" is a private/reserved address`,
        { context: { url: rawUrl, address: host } },
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch (cause) {
    throw new OutboundPolicyError(
      `outbound request blocked — could not resolve host "${host}" to verify it is public`,
      { cause, context: { url: rawUrl, host } },
    );
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new OutboundPolicyError(
        `outbound request blocked — host "${host}" resolves to a private/reserved address (${address})`,
        { context: { url: rawUrl, host, address } },
      );
    }
  }
}

/** Options the socket layer passes to a custom `lookup`. */
type SocketLookupOptions = { family?: number | string; hints?: number; all?: boolean };

/** Callback shape of a socket `lookup` (single-address and `all` forms). */
type SocketLookupCallback = (
  error: Error | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * The connection-time resolver of the pinned dispatcher. It resolves the
 * host once, refuses the connection when ANY returned address is private /
 * reserved, and hands exactly the checked addresses to the socket — so the
 * address that passed the check is the address connected to. A second DNS
 * answer (a rebinding host flipping to `127.0.0.1` / `169.254.169.254`
 * after the pre-check) is caught here, at connect time, on every hop.
 */
function pinnedLookup(
  hostname: string,
  options: SocketLookupOptions,
  callback: SocketLookupCallback,
): void {
  const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;

  const resolving = lookup(hostname, {
    all: true,
    ...(typeof family === "number" ? { family } : {}),
    ...(options.hints !== undefined ? { hints: options.hints } : {}),
  }) as Promise<Array<{ address: string; family: number }>>;

  resolving.then(
    (addresses) => {
      for (const { address } of addresses) {
        if (isPrivateOrReservedIp(address)) {
          callback(
            new OutboundPolicyError(
              `outbound request blocked — host "${hostname}" resolved to a private/reserved address (${address}) when connecting`,
              { context: { host: hostname, address } },
            ),
          );
          return;
        }
      }

      const first = addresses[0];
      if (!first) {
        callback(
          new OutboundPolicyError(
            `outbound request blocked — could not resolve host "${hostname}" to verify it is public`,
            { context: { host: hostname } },
          ),
        );
        return;
      }

      if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    },
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
  );
}

/** Dispatcher class the pinned dispatcher was built from, and the instance. */
let pinned: { from: unknown; dispatcher: object } | undefined;

/**
 * The dispatcher that pins every connection to an address that passed the
 * private-IP check ({@link pinnedLookup}), or `undefined` when pinning is
 * not available: the runtime exposes no default dispatcher, or the app
 * installed its own non-`Agent` global dispatcher (a proxy or a mock), in
 * which case the request keeps going through it and the DNS pre-check
 * remains the guard. TLS still verifies the certificate against the URL's
 * host name: only the address resolution is replaced.
 */
async function pinnedDispatcher(): Promise<object | undefined> {
  const holder = globalThis as unknown as Record<symbol, unknown>;

  if (holder[GLOBAL_DISPATCHER_KEY] === undefined) {
    // The runtime creates its default dispatcher on the first `fetch`.
    try {
      await (await runtimeFetch?.("data:,"))?.arrayBuffer();
    } catch {
      return undefined;
    }
  }

  const current = holder[GLOBAL_DISPATCHER_KEY];
  const DispatcherClass =
    current && typeof current === "object"
      ? (current as { constructor?: unknown }).constructor
      : undefined;

  if (typeof DispatcherClass !== "function" || DispatcherClass.name !== "Agent") {
    return undefined;
  }

  if (pinned?.from !== DispatcherClass) {
    const Agent = DispatcherClass as new (options: {
      connect: { lookup: typeof pinnedLookup };
    }) => object;

    pinned = {
      from: DispatcherClass,
      dispatcher: new Agent({ connect: { lookup: pinnedLookup } }),
    };
  }

  return pinned.dispatcher;
}

/**
 * The first {@link OutboundPolicyError} in an error's `cause` chain. The
 * platform `fetch` wraps a refused connection as `TypeError("fetch
 * failed")`; unwrapping it keeps the policy error the caller catches.
 */
function findPolicyError(error: unknown): OutboundPolicyError | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof OutboundPolicyError) {
      return current;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/**
 * Reject when `signal` aborts before `promise` settles, with the signal's
 * reason. The listener is removed once either side settles.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Merge the internal timeout signal with an optional caller signal. */
function mergeSignals(timeout: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return timeout;

  const controller = new AbortController();
  const abort = (from: AbortSignal) => controller.abort(from.reason);

  if (timeout.aborted) abort(timeout);
  else timeout.addEventListener("abort", () => abort(timeout), { once: true });

  if (external.aborted) abort(external);
  else external.addEventListener("abort", () => abort(external), { once: true });

  return controller.signal;
}

/** Flatten a headers init into a mutable lower-cased-key record. */
function headersToRecord(headersInit?: RequestInit["headers"]): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headersInit).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/**
 * Policy-guarded `fetch`: validates the URL ({@link assertUrlAllowed}),
 * then performs the request with the policy's timeout and (optional)
 * caller signal merged. Returns the raw `Response` — read its body via
 * {@link readTextCapped} to enforce `maxBytes`. Throws
 * {@link OutboundPolicyError} on a policy violation or timeout.
 *
 * Redirects are NEVER delegated to the platform: every hop is issued
 * with `redirect: "manual"` and its `Location` is re-run through
 * {@link assertUrlAllowed} before being followed (capped at
 * `maxRedirects`), so a 3xx from an allowed host cannot smuggle the
 * request to a private / metadata / off-allowlist target. When a hop
 * crosses an origin boundary, only non-credential headers (`accept`,
 * `accept-language`, `content-type`, `user-agent`, …) and the names in
 * `policy.crossOriginHeaders` are sent on. Pass `init.redirect: "manual"`
 * to receive the raw 3xx, or `"error"` to reject on any redirect.
 *
 * **Address pinning.** With `denyPrivateIPsAfterDNS` on and the global
 * `fetch`, every connection resolves its host through a checked lookup and
 * connects only to the addresses that passed — a DNS answer that changes
 * between the pre-check and the connection (DNS rebinding) is refused. An
 * injected `policy.fetch` is used as-is (the pre-check still applies).
 *
 * **Deadline.** `timeoutMs` covers the whole exchange: the request, every
 * redirect hop, and the body read. The returned response's body stream is
 * aborted when the deadline passes, and {@link readTextCapped} rejects
 * with an {@link OutboundPolicyError} at that point.
 */
export async function guardedFetch(
  rawUrl: string,
  policyInput: OutboundPolicy,
  init?: RequestInit,
): Promise<Response> {
  const policy = resolveOutboundPolicy(policyInput);
  let url = await assertUrlAllowed(rawUrl, policy);

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(
      new OutboundPolicyError(`outbound request timed out after ${policy.timeoutMs}ms`, {
        context: { url: rawUrl, timeoutMs: policy.timeoutMs },
      }),
    );
  }, policy.timeoutMs);
  // The deadline outlives this call (it bounds the body read); it must
  // never be what keeps the process alive.
  (timer as unknown as { unref?: () => void }).unref?.();

  const release = (): void => clearTimeout(timer);
  const signal = mergeSignals(timeoutController.signal, policy.signal);
  const redirectMode = init?.redirect ?? "follow";
  const headers = headersToRecord(init?.headers);
  const keepAcrossOrigins = new Set(policy.crossOriginHeaders.map((name) => name.toLowerCase()));
  let method = init?.method ?? "GET";
  let body = init?.body ?? undefined;

  const dispatcher =
    policy.denyPrivateIPsAfterDNS && policy.fetch === globalThis.fetch
      ? await pinnedDispatcher()
      : undefined;

  const settle = (response: Response): Response => {
    responseDeadlines.set(response, { signal, release });
    return response;
  };

  try {
    for (let hop = 0; ; hop++) {
      let response: Response;
      try {
        response = await policy.fetch(url, {
          ...init,
          method,
          headers: { ...headers },
          body,
          redirect: "manual",
          signal,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
      } catch (error) {
        throw findPolicyError(error) ?? error;
      }

      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return settle(response);
      }

      if (redirectMode === "manual") {
        return settle(response);
      }

      if (redirectMode === "error") {
        throw new OutboundPolicyError(
          `outbound request blocked — redirect received with redirect: "error" (${response.status} → ${location})`,
          { context: { url: url.toString(), location, status: response.status } },
        );
      }

      if (hop >= policy.maxRedirects) {
        throw new OutboundPolicyError(
          `outbound request blocked — more than ${policy.maxRedirects} redirects`,
          { context: { url: rawUrl, maxRedirects: policy.maxRedirects } },
        );
      }

      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new OutboundPolicyError(
          `outbound request blocked — invalid redirect Location: ${location}`,
          { context: { url: url.toString(), location } },
        );
      }

      // The redirect target gets the SAME scheme / allowlist / private-IP
      // validation as the original URL.
      const next = await assertUrlAllowed(target.toString(), policy);

      // Discard the interim body so the connection can be reused.
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }

      if (next.origin !== url.origin) {
        for (const name of Object.keys(headers)) {
          if (!CROSS_ORIGIN_SAFE_HEADERS.has(name) && !keepAcrossOrigins.has(name)) {
            delete headers[name];
          }
        }
      }

      // 303 — and the legacy 301/302-on-a-non-GET convention — re-issue
      // as a bodyless GET, matching platform follow semantics.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method !== "GET" &&
          method !== "HEAD")
      ) {
        method = "GET";
        body = undefined;
      }

      url = next;
    }
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Read a response body as UTF-8 text with a hard byte cap. A declared
 * `content-length` over the cap fails fast; otherwise the stream is read
 * chunk-by-chunk and aborted the moment the running total exceeds
 * `maxBytes`. Throws {@link OutboundPolicyError} on overflow.
 *
 * A response from {@link guardedFetch} keeps that request's deadline: a
 * body that is still arriving when `timeoutMs` passes (a server dripping
 * bytes) rejects with an {@link OutboundPolicyError} instead of holding the
 * caller open.
 */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const deadline = responseDeadlines.get(response);

  try {
    return await readCapped(response, maxBytes, deadline?.signal);
  } finally {
    if (deadline) {
      deadline.release();
      responseDeadlines.delete(response);
    }
  }
}

/** {@link readTextCapped}'s body, raced against the request's deadline. */
async function readCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new OutboundPolicyError(
      `outbound response body too large — declared ${declared} bytes exceeds the ${maxBytes}-byte cap`,
      { context: { declared, maxBytes } },
    );
  }

  const withDeadline = <T>(promise: Promise<T>): Promise<T> =>
    signal ? raceAbort(promise, signal) : promise;

  if (!response.body) {
    const text = await withDeadline(response.text());
    if (Buffer.byteLength(text) > maxBytes) {
      throw new OutboundPolicyError(`outbound response body exceeded the ${maxBytes}-byte cap`, {
        context: { maxBytes },
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await withDeadline(reader.read());
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    }

    const { done, value } = chunk;
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OutboundPolicyError(`outbound response body exceeded the ${maxBytes}-byte cap`, {
        context: { maxBytes },
      });
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Convenience: {@link guardedFetch} + {@link readTextCapped}. Returns the
 * response status alongside the (capped) body text so callers can shape
 * their own not-OK error. The body is only read when the response is OK.
 */
export async function fetchTextWithPolicy(
  rawUrl: string,
  policyInput: OutboundPolicy,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; statusText: string; text: string }> {
  const policy = resolveOutboundPolicy(policyInput);
  const response = await guardedFetch(rawUrl, policy, init);

  if (!response.ok) {
    // The body is never read: stop the deadline and free the connection.
    responseDeadlines.get(response)?.release();
    responseDeadlines.delete(response);
    await response.body?.cancel().catch(() => undefined);
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: response.ok ? await readTextCapped(response, policy.maxBytes) : "",
  };
}
