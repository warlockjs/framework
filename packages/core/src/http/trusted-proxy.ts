import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { environment } from "../utils/environment";
import { compileIpMatcher, type IpMatcher } from "./middleware/utils/ip-matcher";

let warnedTrustAll = false;

/**
 * Warn once, in production, when `http.trustProxy` is `true` and no
 * `http.realIpHeader` is set: the client IP is then the leftmost
 * `X-Forwarded-For` entry, which a client can write itself whenever the edge
 * appends to that header.
 */
export function warnOnTrustAllProxies(trustProxy: unknown, realIpHeader: unknown): void {
  if (warnedTrustAll || trustProxy !== true || environment() !== "production") return;

  if (typeof realIpHeader === "string" && realIpHeader.trim().length > 0) return;

  warnedTrustAll = true;

  log.warn(
    "http",
    "trustProxy",
    'http.trustProxy is true, so the client IP is the leftmost X-Forwarded-For entry, which clients can set themselves behind proxies that append to it. Set http.trustProxy to your proxy addresses or CIDR blocks, or set http.realIpHeader to the header your edge overwrites (for example "cf-connecting-ip").',
  );
}

/** The named ranges `http.trustProxy` accepts, as CIDR blocks. */
const NAMED_RANGES: Record<string, string[]> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

const matchers = new Map<string, IpMatcher | null>();

function matcherFor(entries: string[]): IpMatcher | null {
  const key = entries.join(",");
  let matcher = matchers.get(key);

  if (matcher === undefined) {
    const patterns = entries.flatMap((entry) => NAMED_RANGES[entry] ?? [entry]);

    try {
      matcher = compileIpMatcher(patterns, "http.trustProxy");
    } catch {
      matcher = null;
    }

    if (matchers.size >= 100) matchers.clear();

    matchers.set(key, matcher);
  }

  return matcher;
}

/**
 * Whether the socket peer `address` is a proxy `http.trustProxy` trusts:
 * always under `true`, never under `false`, by address or CIDR block for a
 * list, and by the predicate (hop 0) for a function.
 */
export function isTrustedProxyPeer(address: string | undefined, trustProxy: unknown): boolean {
  if (trustProxy === true) return true;

  if (!address) return false;

  if (typeof trustProxy === "function") {
    return (trustProxy as (address: string, hop: number) => boolean)(address, 0) === true;
  }

  const entries =
    typeof trustProxy === "string"
      ? trustProxy.split(",")
      : Array.isArray(trustProxy)
        ? trustProxy.filter((entry): entry is string => typeof entry === "string")
        : [];

  const trimmed = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  if (trimmed.length === 0) return false;

  const matcher = matcherFor(trimmed);

  return matcher !== null && matcher(address);
}

/** What {@link resolveClientIp} reads from a Fastify request. */
export type ClientIpSource = {
  /** Undefined once the client's socket is gone (a dropped stream, a reset connection). */
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

/**
 * The client address of a request: the header named by `http.realIpHeader`
 * when `http.trustProxy` trusts the socket peer that sent it, otherwise the
 * address Fastify resolved against `trustProxy` (`request.ip`: the socket
 * peer when trust is off, the right `X-Forwarded-For` hop when it is on).
 *
 * The one rule behind `request.detectIp()`, `middleware.rateLimit()` and the
 * global `http.rateLimit` key, so every consumer agrees on who the client is.
 *
 * When the client's socket is already gone, `request.ip` is undefined: the
 * socket's remote address is used, and when that is missing too the result is
 * an empty string, never `undefined`. Callers treat an empty address as "no
 * client address" (`ipFilter` refuses it, the rate limiters use one shared
 * bucket, the idempotency scope falls back to `"unknown"`).
 */
export function resolveClientIp(request: ClientIpSource): string {
  // `unknown`: trustProxy accepts a boolean, a CIDR list or a predicate.
  const trustProxy: unknown = config.get("http.trustProxy", false);
  const realIpHeader: unknown = config.get("http.realIpHeader");

  // the header is only as trustworthy as the peer that sent it: a client
  // that reaches the process directly could set it to anything
  if (
    typeof realIpHeader === "string" &&
    realIpHeader.trim().length > 0 &&
    isTrustedProxyPeer(request.socket?.remoteAddress, trustProxy)
  ) {
    const realIp = request.headers[realIpHeader.trim().toLowerCase()];

    if (realIp) {
      // The first address of the header; a blank value falls through to
      // `request.ip`, never to the string "undefined".
      const address = (String(realIp).split(",")[0] ?? "").trim();

      if (address) return address;
    }
  }

  return typeof request.ip === "string" && request.ip.length > 0
    ? request.ip
    : (request.socket?.remoteAddress ?? "");
}
