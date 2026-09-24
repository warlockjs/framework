import type { FastifyReply } from "fastify";

type ParkedCookie = { name: string; value: string; opts?: Record<string, unknown> };

/**
 * `@fastify/cookie` only parks cookies set via `reply.setCookie()` in a map
 * keyed by a private symbol; it serialises them in its own `onSend` hook.
 * Raw-path writers (`raw.writeHead`) bypass `onSend`, so they must call this
 * right before writing headers.
 *
 * Serialises the parked cookies, appends them to the `set-cookie` header
 * (skipping any value already present) and clears the map so a later `onSend`
 * cannot send them twice.
 */
export function flushPendingCookies(reply: FastifyReply): void {
  const parkedSymbol = Object.getOwnPropertySymbols(reply).find(
    symbol => symbol.description === "fastify.reply.setCookies",
  );

  if (!parkedSymbol) return;

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
