import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createInMemoryTraceStore } from "../store/in-memory-trace-store";
import { createRequestHandler, type ServeConfig } from "./serve";

function fakeReq(opts: {
  url?: string;
  method?: string;
  host?: string;
  auth?: string;
}): IncomingMessage {
  return {
    url: opts.url ?? "/api/traces",
    method: opts.method ?? "GET",
    headers: {
      host: opts.host ?? "127.0.0.1:4319",
      ...(opts.auth ? { authorization: opts.auth } : {}),
    },
  } as unknown as IncomingMessage;
}

type Captured = { status: number; headers: Record<string, string>; body: string };

function fakeRes(): ServerResponse & { captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: "" };
  const res = {
    captured,
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      Object.assign(captured.headers, headers ?? {});
      return res;
    },
    end(body?: string) {
      captured.body = body ?? "";
      return res;
    },
  };
  return res as unknown as ServerResponse & { captured: Captured };
}

const baseConfig: ServeConfig = {
  basePath: "/",
  title: "Panoptic",
  allowedHosts: ["127.0.0.1", "localhost"],
};

describe("dashboard serve — security (S4)", () => {
  it("sets security headers on responses", () => {
    const handle = createRequestHandler(createInMemoryTraceStore(), baseConfig);
    const res = fakeRes();
    handle(fakeReq({ url: "/api/traces" }), res);

    expect(res.captured.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.captured.headers["x-frame-options"]).toBe("DENY");
    expect(res.captured.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("rejects a request whose Host is not in the allowlist (DNS-rebinding guard)", () => {
    const handle = createRequestHandler(createInMemoryTraceStore(), baseConfig);
    const res = fakeRes();
    handle(fakeReq({ host: "evil.example.com" }), res);

    expect(res.captured.status).toBe(403);
  });

  it("requires the bearer token when authToken is configured", () => {
    const config: ServeConfig = { ...baseConfig, authToken: "s3cr3t" };
    const handle = createRequestHandler(createInMemoryTraceStore(), config);

    const noAuth = fakeRes();
    handle(fakeReq({}), noAuth);
    expect(noAuth.captured.status).toBe(401);

    const withHeader = fakeRes();
    handle(fakeReq({ auth: "Bearer s3cr3t" }), withHeader);
    expect(withHeader.captured.status).toBe(200);

    const withQuery = fakeRes();
    handle(fakeReq({ url: "/api/traces?token=s3cr3t" }), withQuery);
    expect(withQuery.captured.status).toBe(200);
  });
});
