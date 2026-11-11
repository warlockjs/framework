import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Host names that always reach this machine, so DNS cannot be pointed at them. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Headers a proxy or tunnel adds; their presence means the loopback peer is not the visitor. */
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded"] as const;

/** At most this many distinct refusals are logged per boot. */
const MAX_WARNINGS = 20;

/**
 * Whether `address` is a loopback address. Deliberately reads
 * `request.socket.remoteAddress` rather than `request.ip`, which honours
 * `X-Forwarded-For` when the app trusts a proxy — a header any client can
 * set.
 */
function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/** The lower-cased host name of a `Host` header value, without its port (`[::1]` keeps its brackets). */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();

  if (value.startsWith("[")) {
    const end = value.indexOf("]");

    return end === -1 ? "" : value.slice(0, end + 1);
  }

  const colon = value.indexOf(":");
  const name = colon === -1 ? value : value.slice(0, colon);

  return name.endsWith(".") ? name.slice(0, -1) : name;
}

/**
 * Whether `hostname` is a loopback name or one of `allowedHosts`. An entry
 * starting with `.` matches that domain and every subdomain of it.
 */
export function isAllowedDevtoolsHost(
  hostname: string,
  allowedHosts: readonly string[] = [],
): boolean {
  if (!hostname) return false;
  if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost")) return true;

  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();

    if (allowed.startsWith(".")) {
      return hostname === allowed.slice(1) || hostname.endsWith(allowed);
    }

    return hostname === allowed;
  });
}

/** The `Origin` header's host name, `""` for `null` or an unparsable value. */
function originHostname(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Why `request` must be refused, or `undefined` when it may be served.
 * `"not-local"` is the silent case (production, or a remote socket). Beyond a
 * loopback socket, the request must be ADDRESSED to a loopback (or allowed)
 * host, come from such an origin, and not have passed through a proxy: a page
 * whose domain was re-pointed at 127.0.0.1, or a tunnel, also arrives on a
 * loopback socket.
 */
function refusalReason(request: FastifyRequest, deps: MountDevtoolsRoutesDeps): string | undefined {
  if (!deps.isDevelopment() || !isLoopbackAddress(request.socket.remoteAddress)) {
    return "not-local";
  }

  const allowedHosts = deps.options.allowedHosts ?? [];
  const host = hostnameOf(request.headers.host ?? "");

  if (!isAllowedDevtoolsHost(host, allowedHosts)) {
    return `Devtools refused a request for host "${host}". Open the dashboard on localhost, or add the host to the devtools "allowedHosts" option.`;
  }

  const origin = request.headers.origin;

  if (origin !== undefined && !isAllowedDevtoolsHost(originHostname(origin), allowedHosts)) {
    return `Devtools refused a request from origin "${origin}". Only pages served from localhost or a host in the devtools "allowedHosts" option may call the dashboard.`;
  }

  if (
    !deps.options.allowProxied &&
    PROXY_HEADERS.some((name) => request.headers[name] !== undefined)
  ) {
    return 'Devtools refused a proxied request (it carries a forwarding header). Open the dashboard directly on localhost, or set the devtools "allowProxied" option for a local proxy nobody else can reach.';
  }

  return undefined;
}

/**
 * Registers the dev-only, local-only guard as an `onRequest` hook on
 * `server`. Callers must register this inside an encapsulated Fastify
 * context (a plugin/prefix) so the hook never reaches routes outside the
 * dashboard.
 */
export function registerDevtoolsGuard(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  // One terminal line per distinct refusal, so a misconfigured host is
  // explained once without flooding the log on every poll.
  const warned = new Set<string>();

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const reason = refusalReason(request, deps);

    if (reason === undefined) return;

    if (reason !== "not-local" && !warned.has(reason) && warned.size < MAX_WARNINGS) {
      warned.add(reason);
      deps.warn?.(reason);
    }

    // Returning the reply is what stops the lifecycle in an async hook;
    // without it Fastify still runs the handler after the 404 is sent.
    return reply.code(404).send();
  });
}
