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
