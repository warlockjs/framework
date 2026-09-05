import { defaultHttpConfigurations } from "./config";

/**
 * Fallback used only if `defaultHttpConfigurations.port` is ever unset —
 * `HttpConfigurations.port` is typed optional for consumers, but the
 * framework's own default configuration always declares one. Keeps
 * `resolveBindPort`'s return type a plain `number` without an `as`.
 */
const FALLBACK_PORT = 3000;

/**
 * Resolve a raw, possibly-stringy `http.port` value into the number the
 * socket layer will actually bind.
 *
 * `env()` only coerces a `.env` value to a number when it round-trips
 * exactly (`String(Number(v)) === v`), so values like `"03999"`, `" 3999"`,
 * `"+3999"` or `"1e3"` arrive here as strings. `net.Server.listen({ port })`
 * happily accepts every one of those and binds SOMETHING — `"1e3"` binds
 * port 1000 with no diagnostic anywhere — so this is the one place the
 * configured port is turned into a canonical integer before anything binds,
 * logs, or reports it.
 *
 * `undefined`/`null` (no `http.port` configured at all) resolves to the
 * framework default rather than throwing — that case is not misconfiguration.
 *
 * @throws {Error} when the raw value cannot be resolved to a usable TCP port
 * (0-65535, finite integer) — naming the raw value and where to fix it.
 */
export function resolveBindPort(rawPort: unknown): number {
  if (rawPort === undefined || rawPort === null) {
    return defaultHttpConfigurations.port ?? FALLBACK_PORT;
  }

  const resolved = Number(String(rawPort).trim());

  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 65_535) {
    throw new Error(
      `Invalid http port ${JSON.stringify(rawPort)}: it does not resolve to a usable TCP port ` +
        `(0-65535, whole number). Fix HTTP_PORT in .env, or http.port in src/config/http.ts.`,
    );
  }

  return resolved;
}

/**
 * Whether `rawPort` was already the canonical value `resolveBindPort`
 * returned for it — i.e. nothing needed normalising.
 *
 * Lets a caller print exactly one notice when the configured port and the
 * bound port differ in representation (`"03999"` -> `3999`), and stay silent
 * for the ordinary case (a plain number, or a string that was already
 * canonical).
 */
export function isCanonicalPortValue(rawPort: unknown, resolved: number): boolean {
  if (typeof rawPort === "number" || rawPort === undefined || rawPort === null) {
    return true;
  }

  return String(rawPort) === String(resolved);
}
