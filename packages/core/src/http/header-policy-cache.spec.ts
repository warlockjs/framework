import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import { Application } from "../application/application";
import { applyCspHeader, buildCspHeaderValue } from "./csp";
import { isAllowedCsrfOrigin } from "./csrf-origin-policy";
import { reloadGate } from "./reload-gate";
import {
  applySecurityHeadersToRaw,
  buildSecurityHeaders,
  frameAncestorSources,
  resolveSecurityHeadersConfig,
} from "./security-headers";

function fakeRaw() {
  const headers: Record<string, string> = {};

  return {
    headers,
    headersSent: false,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

afterEach(() => {
  config.set("http.securityHeaders", undefined);
  config.set("http.csp", undefined);
  config.set("auth.csrf", undefined);
});

describe("security headers", () => {
  it("stamps the same headers the builder produces, request after request", () => {
    const expected = buildSecurityHeaders(resolveSecurityHeadersConfig());

    for (let index = 0; index < 3; index++) {
      const raw = fakeRaw();

      applySecurityHeadersToRaw(raw);

      expect(raw.headers).toEqual(expected);
    }
  });

  it("follows a replaced config object and keeps route overrides apart", () => {
    applySecurityHeadersToRaw(fakeRaw());

    config.set("http.securityHeaders", { referrerPolicy: "no-referrer" });

    const app = fakeRaw();
    applySecurityHeadersToRaw(app);
    expect(app.headers["Referrer-Policy"]).toBe("no-referrer");

    const routeConfig = { referrerPolicy: "same-origin" as const };
    const route = fakeRaw();
    applySecurityHeadersToRaw(route, routeConfig);
    expect(route.headers["Referrer-Policy"]).toBe("same-origin");

    const appAgain = fakeRaw();
    applySecurityHeadersToRaw(appAgain);
    expect(appAgain.headers["Referrer-Policy"]).toBe("no-referrer");

    const off = fakeRaw();
    applySecurityHeadersToRaw(off, false);
    expect(off.headers).toEqual({});
  });

  it("follows the environment (HSTS is production only)", () => {
    const previous = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = "production";
      const production = fakeRaw();
      applySecurityHeadersToRaw(production);
      expect(production.headers["Strict-Transport-Security"]).toBeDefined();

      process.env.NODE_ENV = "test";
      const test = fakeRaw();
      applySecurityHeadersToRaw(test);
      expect(test.headers["Strict-Transport-Security"]).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("Content-Security-Policy", () => {
  function stamp(nonce: string, securityHeaders?: unknown) {
    const headers: Record<string, string> = {};
    const request = { nonce, route: { securityHeaders } };
    const response = {
      header: (name: string, value: string) => {
        headers[name] = value;
      },
    };

    applyCspHeader(request as never, response as never);

    return headers;
  }

  it("matches the full builder output with each request's own nonce", () => {
    const cspConfig = { enabled: true, directives: { "img-src": ["'self'", "data:"] } };
    config.set("http.csp", cspConfig);

    const frameAncestors = frameAncestorSources("none");
    const first = stamp("nonce-one");
    const second = stamp("nonce-two");

    expect(first["Content-Security-Policy"]).toBe(
      buildCspHeaderValue(cspConfig, "nonce-one", frameAncestors),
    );
    expect(second["Content-Security-Policy"]).toBe(
      buildCspHeaderValue(cspConfig, "nonce-two", frameAncestors),
    );
  });

  it("rebuilds for a replaced config and a route override", () => {
    config.set("http.csp", { enabled: true });
    stamp("n1");

    config.set("http.csp", { enabled: true, reportOnly: true, directives: { "img-src": ["*"] } });

    const reportOnly = stamp("n2");
    expect(reportOnly["Content-Security-Policy-Report-Only"]).toContain("img-src *");

    const route = stamp("n3", { frameAncestors: "self" });
    expect(route["Content-Security-Policy-Report-Only"]).toContain("frame-ancestors 'self'");
  });
});

describe("CSRF allowed origins", () => {
  it("matches configured origins written with or without the default port", () => {
    const request = {
      protocol: "https",
      hostname: "app.example.com",
      header: () => undefined,
    };

    config.set("auth.csrf", { allowedOrigins: ["https://partner.example.com:443"] });

    expect(isAllowedCsrfOrigin("https://partner.example.com", request as never)).toBe(true);
    expect(isAllowedCsrfOrigin("https://other.example.com", request as never)).toBe(false);

    config.set("auth.csrf", { allowedOrigins: ["https://other.example.com"] });

    expect(isAllowedCsrfOrigin("https://other.example.com", request as never)).toBe(true);
    expect(isAllowedCsrfOrigin("https://partner.example.com", request as never)).toBe(false);
  });
});

describe("reload gate", () => {
  let harness: HttpHarness | undefined;
  const previous = Application.runtimeStrategy;

  afterEach(async () => {
    reloadGate.end();
    await harness?.close();
    harness = undefined;
    Application.setRuntimeStrategy(previous);
  });

  it("is not installed on a production server", async () => {
    Application.setRuntimeStrategy("production");

    harness = await bootHarness((router) => {
      router.get("/gate", ({ response }) => response.success({ ok: true }));
    });

    reloadGate.begin();

    const result = await harness.inject({ method: "GET", url: "/gate" });

    expect(result.statusCode).toBe(200);
  });
});
