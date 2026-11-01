import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { buildCspHeaderValue, mergeCspDirectives } from "./csp";
import {
  applyRouteSecurityHeaders,
  applySecurityHeadersToRaw,
  buildSecurityHeaders,
  frameOptionsFor,
  mergeSecurityHeadersConfig,
  resolveSecurityHeadersConfig,
  serializePermissionsPolicy,
} from "./security-headers";

const previousEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = previousEnv;
  config.set("http.securityHeaders", undefined);
  config.set("http.csp", undefined);
});

function fakeRaw() {
  const headers = new Map<string, string>();

  return {
    headers,
    headersSent: false,
    setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), value),
    removeHeader: (name: string) => void headers.delete(name.toLowerCase()),
  };
}

describe("buildSecurityHeaders", () => {
  it("emits the secure defaults, without HSTS outside production", () => {
    process.env.NODE_ENV = "development";

    expect(buildSecurityHeaders({})).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy":
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=()",
    });
  });

  it("adds HSTS in production, with preload only when asked", () => {
    process.env.NODE_ENV = "production";

    expect(buildSecurityHeaders({})["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(
      buildSecurityHeaders({ hsts: { preload: true, maxAge: 100 } })["Strict-Transport-Security"],
    ).toBe("max-age=100; includeSubDomains; preload");
    expect(buildSecurityHeaders({ hsts: false })["Strict-Transport-Security"]).toBeUndefined();
  });

  it("can send HSTS in every environment", () => {
    process.env.NODE_ENV = "development";

    expect(
      buildSecurityHeaders({ hsts: { onlyInProduction: false } })["Strict-Transport-Security"],
    ).toBe("max-age=31536000; includeSubDomains");
  });

  it("maps frameAncestors to both headers; a custom list omits X-Frame-Options", () => {
    expect(buildSecurityHeaders({ frameAncestors: "self" })).toMatchObject({
      "Content-Security-Policy": "frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
    });

    const custom = buildSecurityHeaders({ frameAncestors: ["'self'", "https://a.example.com"] });

    expect(custom["Content-Security-Policy"]).toBe("frame-ancestors 'self' https://a.example.com");
    expect(custom["X-Frame-Options"]).toBeUndefined();
    expect(frameOptionsFor(["'none'"])).toBe("DENY");
  });

  it("drops each header when its key is false", () => {
    const headers = buildSecurityHeaders({
      frameAncestors: false,
      contentTypeOptions: false,
      referrerPolicy: false,
      permissionsPolicy: false,
      hsts: false,
    });

    expect(headers).toEqual({});
  });

  it("merges permissionsPolicy objects over the defaults per feature", () => {
    const value = buildSecurityHeaders({
      permissionsPolicy: { camera: ["self"], fullscreen: ["self", "https://x.example.com"] },
    })["Permissions-Policy"];

    expect(value).toContain("camera=(self)");
    expect(value).toContain('fullscreen=(self "https://x.example.com")');
    expect(value).toContain("microphone=()");
    expect(serializePermissionsPolicy({ geolocation: ["*"] })).toBe("geolocation=*");
  });

  it("returns nothing for an undefined config", () => {
    expect(buildSecurityHeaders(undefined)).toEqual({});
  });
});

describe("config merging", () => {
  it("treats unset and true as the defaults, false as off", () => {
    expect(resolveSecurityHeadersConfig()).toEqual({});
    config.set("http.securityHeaders", true);
    expect(resolveSecurityHeadersConfig()).toEqual({});
    config.set("http.securityHeaders", false);
    expect(resolveSecurityHeadersConfig()).toBeUndefined();
  });

  it("merges a route override over the app config; false at either level wins", () => {
    expect(
      mergeSecurityHeadersConfig({ frameAncestors: "self" }, { referrerPolicy: "no-referrer" }),
    ).toEqual({
      frameAncestors: "self",
      referrerPolicy: "no-referrer",
    });
    expect(mergeSecurityHeadersConfig({}, false)).toBeUndefined();
    expect(mergeSecurityHeadersConfig(false, {})).toBeUndefined();
  });

  it("lets http.csp's own frame-ancestors win and keeps X-Frame-Options in step", () => {
    config.set("http.csp", { enabled: true, directives: { "frame-ancestors": ["'self'"] } });

    expect(buildSecurityHeaders({ frameAncestors: "none" })).toMatchObject({
      "Content-Security-Policy": "frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
    });
  });
});

describe("merging with http.csp", () => {
  it("replaces the default frame-ancestors with the securityHeaders policy, once", () => {
    const value = buildCspHeaderValue({ enabled: true }, "n", ["'none'"]);

    expect(value.match(/frame-ancestors/g)).toHaveLength(1);
    expect(value).toContain("frame-ancestors 'none'");
  });

  it("keeps an app-declared frame-ancestors over the securityHeaders policy", () => {
    const merged = mergeCspDirectives({ "frame-ancestors": ["https://a.example.com"] }, "n", [
      "'none'",
    ]);

    expect(merged["frame-ancestors"]).toEqual(["https://a.example.com"]);
  });
});

describe("raw application", () => {
  it("sets headers on the raw response and skips a sent one", () => {
    const raw = fakeRaw();

    applySecurityHeadersToRaw(raw);
    expect(raw.headers.get("x-content-type-options")).toBe("nosniff");

    const sent = { ...fakeRaw(), headersSent: true };

    applySecurityHeadersToRaw(sent);
    expect(sent.headers.size).toBe(0);
  });

  it("re-stamps for a route: removes the app pass, then applies the override", () => {
    const raw = fakeRaw();

    applySecurityHeadersToRaw(raw);
    applyRouteSecurityHeaders(raw, { frameAncestors: false });

    expect(raw.headers.has("x-frame-options")).toBe(false);
    expect(raw.headers.has("content-security-policy")).toBe(false);
    expect(raw.headers.get("x-content-type-options")).toBe("nosniff");

    applyRouteSecurityHeaders(raw, false);
    expect(raw.headers.size).toBe(0);
  });
});
