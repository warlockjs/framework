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
 */

/** Hosts that all mean "this machine" for the purpose of comparing addresses. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", ""]);

export type ServerAddressReport = {
  /** Where the server is genuinely reachable. Always present. */
  ready: string;
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
): ServerAddressReport {
  const bound = parseUrl(boundAddress);
  const configured = parseUrl(baseUrl);

  // No bound address to report means the caller could not obtain one; the
  // configured URL is then the only thing we know, and saying nothing would be
  // worse than saying the one thing we have.
  if (!bound) {
    return { ready: `Server ready at ${configured?.href ?? boundAddress ?? baseUrl}` };
  }

  const ready = `Server ready at ${boundAddress}`;

  if (!configured) return { ready };

  if (!isLoopback(configured)) {
    return { ready, publicUrl: `Public URL (app.baseUrl): ${baseUrl}` };
  }

  if (effectivePort(configured) === effectivePort(bound)) {
    return { ready };
  }

  return {
    ready,
    warning:
      `app.baseUrl is ${baseUrl}, but the server bound port ${effectivePort(bound)}. ` +
      `Nothing is listening on port ${effectivePort(configured)} — ` +
      `check BASE_URL and PORT, including anything exported in your shell.`,
  };
}
