import { isIP } from "node:net";
import type { DevtoolsClientInfo, DevtoolsProxyRequest } from "./types";
import { ipMatches, normalizeIp } from "./ip";

/** The first value of a header that may repeat or hold a comma list. */
function firstValue(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  const first = text?.split(",")[0]?.trim();

  return first === undefined || first === "" ? undefined : first;
}

/** The host name of a `Host` value: no port, lower case, brackets of an IPv6 literal kept. */
function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();

  if (value.startsWith("[")) {
    const end = value.indexOf("]");

    return end === -1 ? value : value.slice(0, end + 1);
  }

  const colon = value.indexOf(":");

  return colon === -1 ? value : value.slice(0, colon);
}

/** The client address out of an `X-Forwarded-For` value, walking right to left past trusted hops. */
function forwardedClient(
  header: string | string[] | undefined,
  trusted: readonly string[],
): string | undefined {
  const text = Array.isArray(header) ? header.join(",") : header;
  const hops = (text ?? "")
    .split(",")
    .map((hop) => normalizeIp(hop.trim().replace(/^\[|\]$/g, "")))
    .filter((hop) => isIP(hop) !== 0);

  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];

    if (hop !== undefined && !ipMatches(hop, trusted)) return hop;
  }

  // Every hop is a trusted proxy: the leftmost is the origin of the chain.
  return hops[0];
}

/**
 * The client IP, protocol and host. Forwarding headers are read only when the
 * socket peer is a trusted proxy; `X-Forwarded-For` is walked right to left,
 * skipping trusted addresses, and the first untrusted one is the client.
 */
export function resolveClient(
  request: DevtoolsProxyRequest,
  trustedProxies: readonly string[],
): DevtoolsClientInfo {
  const peer = normalizeIp(request.socket.remoteAddress ?? "");
  const headers = request.headers;
  let ip = peer;
  let proto = request.socket.encrypted === true ? "https" : "http";
  let host = firstValue(headers.host) ?? "";

  if (peer !== "" && ipMatches(peer, trustedProxies)) {
    ip = forwardedClient(headers["x-forwarded-for"], trustedProxies) ?? peer;

    const forwardedProto = firstValue(headers["x-forwarded-proto"])?.toLowerCase();

    if (forwardedProto === "http" || forwardedProto === "https") proto = forwardedProto;

    host = firstValue(headers["x-forwarded-host"]) ?? host;
  }

  host = host.toLowerCase();

  return { ip, proto, hostname: hostnameOf(host), host };
}
