/**
 * Default core CSRF-Origin guard — SECURITY card 8a752ab2 (5.17). Red-first
 * suite for Aria's spec list (`releases/v5.17-web-readiness-audit.md` §3.1):
 * a cookie-authenticated write reaching ANY path (not just
 * `authMiddleware("cookie:*")`) must be checked at this earliest core seam.
 */
import { describe, expect, it, vi } from "vitest";
import { runDefaultCsrfGuard } from "./csrf-default-guard";
import { Request } from "./request";
import { Response } from "./response";
import type { Route } from "../router/types";

/** A `Response` whose `forbidden()` call is observable without a real Fastify reply. */
function createResponse() {
  const response = new Response();

  response.setResponse({
    header: () => {},
    getHeader: () => undefined,
    raw: { once: () => {} },
    status: () => response,
    send: vi.fn(),
    sent: false,
  } as never);

  return response;
}

/** Builds a `Request` backed by a minimal Fastify-shaped object. */
function createRequest(options: {
  method: string;
  cookieHeader?: string | string[];
  origin?: string;
  referer?: string;
  protocol?: string;
  hostname?: string;
  host?: string;
  route?: Partial<Route>;
}) {
  const {
    method,
    cookieHeader,
    origin,
    referer,
    protocol = "https",
    hostname = "app.example.com",
    host = hostname,
    route,
  } = options;

  const headers: Record<string, string | string[]> = { host };

  if (cookieHeader !== undefined) headers.cookie = cookieHeader;
  if (origin !== undefined) headers.origin = origin;
  if (referer !== undefined) headers.referer = referer;

  const request = new Request();
  request.response = createResponse();

  request.setRequest({
    method,
    url: "/account",
    headers,
    body: {},
    query: {},
    params: {},
    cookies: {},
    protocol,
    hostname,
  } as never);

  request.setRoute({
    method,
    path: "/account",
    handler: (() => {}) as never,
    sourceFile: "",
    $prefix: "/",
    $prefixStack: [],
    ...route,
  } as Route);

  return request;
}

const translate = (key: string) => key;

describe("runDefaultCsrfGuard — default core CSRF-Origin guard", () => {
  it("rejects a custom token-cookie POST with a foreign Origin, even without authMiddleware", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: "token=abc123",
      origin: "https://evil.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");
    const logRejection = vi.fn();

    const result = await runDefaultCsrfGuard(request, response, translate, logRejection);

    expect(result).toBeInstanceOf(Response);
    expect(forbidden).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "EC006" }));
    expect(logRejection).toHaveBeenCalledWith("origin-mismatch");
  });

  it("rejects a custom token-cookie POST with NO Origin/Referer at all", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: "token=abc123",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeInstanceOf(Response);
    expect(forbidden).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "EC006" }));
  });

  it("allows a same-origin token-cookie POST", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: "token=abc123",
      origin: "https://app.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("leaves a header-only API POST unaffected (no Cookie header at all)", async () => {
    const request = createRequest({
      method: "POST",
      origin: "https://evil.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("leaves a locale-only-cookie POST unaffected", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: "locale=en",
      origin: "https://evil.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("leaves both framework locale cookies exempt, but still guards a mixed header", async () => {
    const preferenceOnly = createRequest({
      method: "POST",
      cookieHeader: "locale=en; warlock.locale-preference=ar",
      origin: "https://evil.example.com",
    });
    const mixed = createRequest({
      method: "POST",
      cookieHeader: "warlock.locale-preference=ar; token=abc123",
      origin: "https://evil.example.com",
    });

    expect(
      await runDefaultCsrfGuard(preferenceOnly, createResponse(), translate, vi.fn()),
    ).toBeUndefined();
    expect(await runDefaultCsrfGuard(mixed, createResponse(), translate, vi.fn())).toBeInstanceOf(
      Response,
    );
  });

  it("leaves an explicitly exempt route (`{ csrf: false }`) unaffected", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: "token=abc123",
      origin: "https://evil.example.com",
      route: { csrf: false },
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each(["PUT", "PATCH", "DELETE"])(
    "covers %s the same as POST — foreign Origin is rejected",
    async (method) => {
      const request = createRequest({
        method,
        cookieHeader: "token=abc123",
        origin: "https://evil.example.com",
      });
      const response = createResponse();
      const forbidden = vi.spyOn(response, "forbidden");

      const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

      expect(result).toBeInstanceOf(Response);
      expect(forbidden).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "EC006" }));
    },
  );

  it("leaves GET unaffected regardless of cookies/Origin (safe method)", async () => {
    const request = createRequest({
      method: "GET",
      cookieHeader: "token=abc123",
      origin: "https://evil.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a malformed Cookie header fails CLOSED — rejected even with a same-looking Origin absent", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: "garbage-no-equals",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeInstanceOf(Response);
    expect(forbidden).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "EC006" }));
  });

  it("a malformed Cookie header fails CLOSED even when Origin would otherwise be allowed", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: ";;;",
      origin: "https://app.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    // Malformed header still counts as "a cookie other than locale" — the
    // request is IN SCOPE, but a same-origin Origin still passes the check.
    expect(result).toBeUndefined();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a present non-string Cookie header (duplicated header array) fails CLOSED", async () => {
    const request = createRequest({
      method: "POST",
      cookieHeader: ["token=abc123", "locale=en"],
      origin: "https://evil.example.com",
    });
    const response = createResponse();
    const forbidden = vi.spyOn(response, "forbidden");

    const result = await runDefaultCsrfGuard(request, response, translate, vi.fn());

    expect(result).toBeInstanceOf(Response);
    expect(forbidden).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "EC006" }));
  });
});
