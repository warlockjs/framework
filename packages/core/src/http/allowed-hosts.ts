import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { HttpErrorCodes } from "./error-codes";
import { createRequestRefusal } from "./request-refusal";
import type { FastifyInstance } from "./server";

/**
 * Normalise a host for comparison: lower case, no port, no trailing dot.
 * `[::1]:3000` -> `[::1]`, `Example.COM.:443` -> `example.com`.
 */
export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();

  if (value.startsWith("[")) {
    const end = value.indexOf("]");

    value = end === -1 ? value : value.slice(0, end + 1);
  } else {
    const colon = value.indexOf(":");

    if (colon !== -1) value = value.slice(0, colon);
  }

  return value.endsWith(".") ? value.slice(0, -1) : value;
}

/**
 * Whether `host` is on the list. An entry is an exact host (`example.com`),
 * or a leading-dot suffix (`.example.com`) that matches the domain itself and
 * every subdomain.
 */
export function isAllowedHost(host: string, allowedHosts: readonly string[]): boolean {
  const candidate = normalizeHost(host);

  if (!candidate) return false;

  for (const raw of allowedHosts) {
    const entry = normalizeHost(raw);

    if (!entry) continue;

    if (entry.startsWith(".")) {
      if (candidate === entry.slice(1) || candidate.endsWith(entry)) return true;
    } else if (candidate === entry) {
      return true;
    }
  }

  return false;
}

/**
 * Refuse requests for a host not listed in `http.allowedHosts`, with 400,
 * before routing. Unset (the default) accepts every host.
 *
 * The host checked is the one Fastify resolves: the `Host` header, or
 * `X-Forwarded-Host` when `http.trustProxy` trusts the proxy that sent it.
 * The built-in health endpoints are exempt, since orchestrators probe them by
 * address.
 */
export function registerAllowedHosts(server: FastifyInstance): void {
  const configured: unknown = config.get("http.allowedHosts");

  if (configured === undefined || configured === null) return;

  if (
    !Array.isArray(configured) ||
    !configured.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  ) {
    throw new TypeError(
      'Invalid http.allowedHosts configuration: expected an array of host names, such as ["example.com", ".example.com"].',
    );
  }

  const allowedHosts = configured as string[];
  const exemptPaths = new Set<string>([
    config.get("http.health.path", "/health"),
    config.get("http.health.readinessPath", "/ready"),
  ]);

  server.addHook("onRequest", async (request: FastifyRequest) => {
    const queryIndex = request.url.indexOf("?");
    const path = queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);

    if (exemptPaths.has(path)) return;

    if (isAllowedHost(request.host ?? "", allowedHosts)) return;

    throw createRequestRefusal(
      400,
      HttpErrorCodes.HostNotAllowed,
      "This host is not served here. Add it to http.allowedHosts to accept it.",
    );
  });
}
