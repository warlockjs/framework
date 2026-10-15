import { describe, expect, it } from "vitest";
import { InvalidBaseUrlError } from "../src/errors";
import { isAbsoluteUrl, joinOrigin, normalizeBaseUrl, resolveAgainstBase } from "../src/url";

describe("joinOrigin", () => {
  it("joins a non-trailing-slash origin with exactly one slash", () => {
    expect(joinOrigin("https://example.com", "/about")).toBe("https://example.com/about");
  });

  it("joins a trailing-slash origin with exactly one slash", () => {
    expect(joinOrigin("https://example.com/", "/about")).toBe("https://example.com/about");
  });

  it("adds the slash when the route path omits its leading slash", () => {
    expect(joinOrigin("https://example.com", "about")).toBe("https://example.com/about");
  });

  it("never doubles the slash for trailing-slash origin + leading-slash path", () => {
    const url = joinOrigin("https://example.com/", "/about");

    expect(url).not.toContain("//about");
  });
});

describe("normalizeBaseUrl", () => {
  it("strips the trailing slash so the join seam has exactly one", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com");
  });

  it("keeps a base path", () => {
    expect(normalizeBaseUrl("https://example.com/docs")).toBe("https://example.com/docs");
  });

  it("rejects a relative value", () => {
    expect(() => normalizeBaseUrl("/example")).toThrow(InvalidBaseUrlError);
  });

  it("rejects an empty value", () => {
    expect(() => normalizeBaseUrl("  ")).toThrow(InvalidBaseUrlError);
  });

  // `new URL()` accepts these happily, which is why the protocol is checked
  // explicitly — a <loc> no crawler can fetch is not a valid sitemap.
  it("rejects a non-http(s) protocol `new URL()` would otherwise accept", () => {
    expect(() => normalizeBaseUrl("mailto:hi@example.com")).toThrow(InvalidBaseUrlError);
    expect(() => normalizeBaseUrl("file:///tmp/site")).toThrow(InvalidBaseUrlError);
  });
});

describe("resolveAgainstBase", () => {
  it("joins a path", () => {
    expect(resolveAgainstBase("https://example.com", "/about")).toBe("https://example.com/about");
  });

  it("leaves an absolute URL alone, so a cross-origin alternate survives", () => {
    expect(resolveAgainstBase("https://example.com", "https://example.de/ueber-uns")).toBe(
      "https://example.de/ueber-uns",
    );
  });

  it("recognises only http(s) as absolute", () => {
    expect(isAbsoluteUrl("https://example.com")).toBe(true);
    expect(isAbsoluteUrl("/posts/1")).toBe(false);
  });
});
