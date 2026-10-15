import { createRequire } from "node:module";
import path from "node:path";
import type { FastifyReply } from "fastify";

type ParkedCookie = { name: string; value: string; opts?: Record<string, unknown> };

/** The installed `@fastify/cookie` version, or undefined when it can't be resolved. */
function installedCookiePluginVersion(): string | undefined {
  try {
    const require = createRequire(path.join(process.cwd(), "noop.js"));

    return (require(require.resolve("@fastify/cookie/package.json")) as { version?: string })
      .version;
  } catch {
    return undefined;
  }
}

/**
 * `@fastify/cookie` only parks cookies set via `reply.setCookie()` in a map
 * keyed by a private symbol; it serialises them in its own `onSend` hook.
 * Raw-path writers (`raw.writeHead`) bypass `onSend`, so they must call this
 * right before writing headers.
 *
 * Serialises the parked cookies, appends them to the `set-cookie` header
 * (skipping any value already present) and clears the map so a later `onSend`
 * cannot send them twice.
 *
 * Throws when the plugin is registered but its parked-cookie symbol cannot be
 * found: silently doing nothing would drop every cookie on raw paths. Does
 * nothing when the plugin is not registered.
 */
export function flushPendingCookies(reply: FastifyReply): void {
  const parkedSymbol = Object.getOwnPropertySymbols(reply).find(
    symbol => symbol.description === "fastify.reply.setCookies",
  );

  if (!parkedSymbol) {
    if (typeof (reply as { setCookie?: unknown }).setCookie !== "function") return;

    const version = installedCookiePluginVersion();

    throw new Error(
      `@fastify/cookie's internal cookie storage changed: reply.setCookie exists but the "fastify.reply.setCookies" symbol was not found${
        version ? ` (installed @fastify/cookie@${version})` : ""
      }. Cookies set before a raw-path response would be lost; update flushPendingCookies for this version.`,
    );
  }

  const parked = (reply as unknown as Record<symbol, Map<string, ParkedCookie> | null>)[
    parkedSymbol
  ];

  if (!parked || parked.size === 0) return;

  const serializeCookie = (
    reply.server as unknown as {
      serializeCookie?: (name: string, value: string, opts?: unknown) => string;
    }
  ).serializeCookie;

  if (!serializeCookie) return;

  const existing = reply.getHeader("set-cookie");
  const cookies: string[] =
    existing === undefined ? [] : Array.isArray(existing) ? [...existing] : [String(existing)];

  for (const cookie of parked.values()) {
    const serialized = serializeCookie(cookie.name, cookie.value, cookie.opts);

    if (!cookies.includes(serialized)) {
      cookies.push(serialized);
    }
  }

  reply.removeHeader("set-cookie");
  reply.header("set-cookie", cookies);
  parked.clear();
}
