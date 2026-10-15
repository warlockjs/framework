/**
 * What to say once the HTTP server has bound.
 *
 * ## Why this is not one template string
 *
 * `http-connector.ts` used to bind `httpConfig.port` and then announce
 * `config.get("app.baseUrl")` — a different value, read from a different
 * environment variable (`PORT` vs `BASE_URL`), with nothing checking the two
 * agreed. On 2026-08-24 a server listening on 3000 printed
 * `Server ready at http://localhost:41900`. **Following the line the server
 * itself printed gave connection refused, on a server that was working.** The
 * reference app carried the rule as a comment in `.env` — "must agree with the
 * port in BASE_URL above" — and a rule a comment enforces is not enforced.
 *
 * So the ready line now states the address actually bound. `app.baseUrl` is a
 * separate claim, and it is reported separately.
 *
 * ## Why a disagreement is not fatal
 *
 * A reverse-proxied deployment legitimately binds `0.0.0.0:3000` and publishes
 * `https://example.com`. Refusing to boot on a mismatch would break the correct
 * case, and warning on it would fire on every correct production boot — a
 * warning that always fires is one nobody reads.
 *
 * The mismatch worth a warning is the ACTIONABLE one: a base URL that points at
 * **loopback on a port nothing is listening on**, because someone will paste it
 * into a browser and conclude the server is broken. A non-loopback base URL is
 * a deployment address, reported plainly and never flagged.
 *
 * ## Why the address bound and the address printed are not the same string
 *
 * `listen()` resolves `localhost` and hands back whichever address it actually
 * bound — on a dual-stack machine that is `http://[::1]:2030`. That literal is
 * correct and useless: most terminals will not linkify a bracketed IPv6 host,
 * and on a first run it reads as broken output. So {@link toDisplayUrl} maps
 * the *loopback and wildcard* spellings onto `localhost`, which resolves back
 * to the very socket that was bound.
 *
 * This is a DISPLAY transform and nothing else — `host` still reaches
 * `listen()` untouched (`http-connector.ts`), so the set of interfaces the
 * server accepts on is byte-for-byte what it was. A genuine routable IPv6
 * address is left exactly as it is: there is no synonym for it, and inventing
 * one would be the same class of lie as printing `app.baseUrl` was.
 */

/** Hosts that all mean "this machine" for the purpose of comparing addresses. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", ""]);

/**
 * Hosts for which `localhost` is a truthful, reachable synonym.
 *
 * The two loopback literals are exact synonyms. The two wildcards (`::`,
 * `0.0.0.0`) are not synonyms — they are strictly wider — but every one of them
 * *includes* loopback, so `localhost` always reaches the server. Callers that
 * need to tell the reader the bind is wider than loopback should say so
 * separately; see `dev-server/ready-block.ts`.
 *
 * The bracketed spellings are the ones that actually occur: WHATWG `hostname`
 * KEEPS the brackets for an IPv6 host (`new URL("http://[::1]:1").hostname ===
 * "[::1]"`). The bare forms are listed too so a caller that hands over a host
 * rather than a URL is not silently missed.
 */
const DISPLAY_AS_LOCALHOST = new Set(["127.0.0.1", "[::1]", "::1", "0.0.0.0", "[::]", "::"]);

/** The wildcard spellings — a bind wider than loopback. */
const WILDCARD_HOSTS = new Set(["0.0.0.0", "[::]", "::"]);

/**
 * Whether the given bound address listens on more than loopback.
 *
 * Used to add "(all interfaces)" next to a URL that has been rewritten to
 * `localhost`, so the rewrite never hides a wider bind than the reader thinks.
 */
export function isWildcardBind(boundAddress: string | undefined): boolean {
  const url = parseUrl(boundAddress);

  if (!url) return false;

  return WILDCARD_HOSTS.has(url.hostname);
}

/**
 * Whether the host a caller ASKED to bind is a wildcard.
 *
 * Needed because `isWildcardBind` alone cannot answer this. Fastify's
 * `listen()` normalises a `0.0.0.0` bind and resolves back
 * `http://127.0.0.1:<port>` — the loopback spelling — while `::` comes back
 * as `http://[::]:<port>` untouched. So the returned address reports the
 * wildcard for one of the two spellings and hides it for the other, and
 * `0.0.0.0` is the one people actually write.
 *
 * The requested host is the ground truth for INTENT; the bound address is the
 * ground truth for what happened. A wildcard in either is a wildcard bind.
 */
export function isWildcardHost(host: string | undefined): boolean {
  if (!host) return false;

  return WILDCARD_HOSTS.has(host.trim().toLowerCase());
}

/**
 * The address as it should be SHOWN to a human. See the module doc above.
 *
 * Anything unparseable is returned untouched: a best-effort prettifier must
 * never be the reason a developer is shown something other than what the
 * server reported.
 */
export function toDisplayUrl(boundAddress: string | undefined): string {
  if (!boundAddress) return "";

  const url = parseUrl(boundAddress);

  if (!url) return boundAddress;

  if (!DISPLAY_AS_LOCALHOST.has(url.hostname)) return boundAddress;

  url.hostname = "localhost";

  // `URL.href` re-appends a trailing slash to a bare origin, which is noise in
  // a status line and is not what `listen()` returned.
  return url.href.replace(/\/$/, "");
}

export type ServerAddressReport = {
  /** Where the server is genuinely reachable, spelled for a human. Always present. */
  ready: string;
  /**
   * The same address as a bare URL, ready to paste into a browser — the value
   * `ready` embeds. Callers that render their own layout (the dev ready block)
   * use this instead of re-deriving it.
   */
  url: string;
  /**
   * Exactly what `listen()` returned, untransformed. Kept so a caller that
   * needs to reason about the BIND (which interfaces, which family) reads the
   * fact rather than the presentation of it.
   */
  boundAddress?: string;
  /** Whether the bind covers more than loopback (`0.0.0.0` / `::`). */
  wildcardBind: boolean;
  /** The configured public address, when it is a deployment URL rather than a local one. */
  publicUrl?: string;
  /** Set only when `app.baseUrl` points at loopback on a port nothing bound. */
  warning?: string;
};

function parseUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    return new URL(value);
  } catch {
    // An unparseable base URL is a separate problem, and it is NOT evidence of
    // a port mismatch — reporting one from it would be a guess.
    return undefined;
  }
}

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

/** `:3000` explicitly, or the protocol's default when the URL omits it. */
function effectivePort(url: URL): string {
  if (url.port) return url.port;

  return url.protocol === "https:" ? "443" : "80";
}

export function describeServerAddress(
  boundAddress: string | undefined,
  baseUrl: unknown,
  /**
   * The host passed to `listen()`. Optional so existing callers keep working,
   * but the connector passes it: without it a `0.0.0.0` bind is reported as
   * loopback-only, and the dev block then omits its "(all interfaces)" note in
   * exactly the case a developer most needs it.
   */
  requestedHost?: string,
): ServerAddressReport {
  const bound = parseUrl(boundAddress);
  const configured = parseUrl(baseUrl);

  // No bound address to report means the caller could not obtain one; the
  // configured URL is then the only thing we know, and saying nothing would be
  // worse than saying the one thing we have.
  if (!bound) {
    const fallback = String(configured?.href ?? boundAddress ?? baseUrl ?? "");

    return {
      ready: `Server ready at ${fallback}`,
      url: fallback,
      boundAddress,
      wildcardBind: isWildcardHost(requestedHost),
    };
  }

  // The URL a human is shown. `boundAddress` (the literal `listen()` returned)
  // travels on the report untouched — see the module doc on why these differ.
  const url = toDisplayUrl(boundAddress);
  const base = {
    ready: `Server ready at ${url}`,
    url,
    boundAddress,
    wildcardBind: isWildcardBind(boundAddress) || isWildcardHost(requestedHost),
  };

  if (!configured) return base;

  if (!isLoopback(configured)) {
    return { ...base, publicUrl: `Public URL (app.baseUrl): ${baseUrl}` };
  }

  if (effectivePort(configured) === effectivePort(bound)) {
    return base;
  }

  return {
    ...base,
    warning:
      `app.baseUrl is ${baseUrl}, but the server bound port ${effectivePort(bound)}. ` +
      `Nothing is listening on port ${effectivePort(configured)} — ` +
      `check BASE_URL and PORT, including anything exported in your shell.`,
  };
}
