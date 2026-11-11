import { isIP } from "node:net";
import type { Request } from "@warlock.js/core";
import type { HostResolver, SitesConfig } from "../sites/site-config.types";
import { createSiteSelector, type ResolveCacheOptions } from "../sites/site-selector";
import { normalizeHost } from "../sites/validate-sites-config";

/**
 * Who may call the ask endpoint: everyone (`"any"`, the default), loopback
 * callers only, loopback and private-network callers, or an explicit list of
 * caller IP addresses. Checked against the connection's peer address, which a
 * client cannot forge with forwarding headers.
 */
export type TlsAskAllow = "any" | "loopback" | "private" | readonly string[];

export type TlsAskHandlerOptions = {
  sites: SitesConfig;
  resolveHost?: HostResolver;
  resolveCache?: ResolveCacheOptions;
  /** Default `"any"`. */
  allow?: TlsAskAllow;
};

type TlsAskInput = { domain: string | undefined; request: Request };
type TlsAskResult = { status: 200 | 400 | 403 | 404 };

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Longest valid DNS name. */
const MAX_DOMAIN_LENGTH = 253;

function validDomain(domain: string | undefined): domain is string {
  if (!domain || domain.trim() !== domain || domain.includes("://") || domain.includes("/")) {
    return false;
  }

  const host = normalizeHost(domain);
  return host.length <= MAX_DOMAIN_LENGTH && HOSTNAME.test(host) && isIP(host) === 0;
}

/** Strips the IPv4-mapped IPv6 prefix (`::ffff:127.0.0.1`) so both forms compare equal. */
function plainAddress(address: string): string {
  const lower = address.toLowerCase();

  return lower.startsWith("::ffff:") && isIP(lower.slice(7)) === 4 ? lower.slice(7) : lower;
}

function isLoopback(address: string): boolean {
  return address === "::1" || (isIP(address) === 4 && address.startsWith("127."));
}

function isPrivateNetwork(address: string): boolean {
  if (isIP(address) === 4) {
    const [first = 0, second = 0] = address.split(".").map(Number);

    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  // Unique local (fc00::/7) and link-local (fe80::/10) IPv6 ranges.
  return address === "::1" || /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

/** The connection's peer address; forwarding headers never reach this check. */
function callerAddress(request: Request): string | undefined {
  const base = request.baseRequest as { socket?: { remoteAddress?: string } } | undefined;
  const address = base?.socket?.remoteAddress;

  return typeof address === "string" && address.length > 0 ? plainAddress(address) : undefined;
}

function callerAllowed(allow: TlsAskAllow, request: Request): boolean {
  if (allow === "any") return true;

  const address = callerAddress(request);

  if (address === undefined) return false;
  if (allow === "loopback") return isLoopback(address);
  if (allow === "private") return isPrivateNetwork(address);

  return allow.some((allowed) => plainAddress(allowed) === address);
}

/**
 * Answers Caddy's on-demand TLS ask request without registering an HTTP route.
 * A domain is allowed only when it has a fixed host entry or a resolver claim.
 */
export function createTlsAskHandler({
  sites,
  resolveHost,
  resolveCache,
  allow = "any",
}: TlsAskHandlerOptions) {
  const selector = createSiteSelector({ sites, resolveHost, resolveCache });

  return async ({ domain, request }: TlsAskInput): Promise<TlsAskResult> => {
    if (!callerAllowed(allow, request)) return { status: 403 };

    if (!validDomain(domain)) return { status: 400 };

    const host = normalizeHost(domain);
    const fixedHost = Object.values(sites).some(
      (site) => "hosts" in site && site.hosts.includes(host),
    );

    if (fixedHost) return { status: 200 };

    const selection = await selector.select({ rawHost: domain, path: "/", request });

    return { status: selection.kind === "site" ? 200 : 404 };
  };
}
