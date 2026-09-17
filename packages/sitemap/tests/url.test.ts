import { describe, expect, it } from "vitest";
import { joinOrigin, MissingPublicUrlError, resolveOrigin } from "../src/url";

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

describe("resolveOrigin", () => {
  it("prefers the configured publicUrl over the env fallback", () => {
    expect(
      resolveOrigin({ publicUrl: "https://from-config.com", env: { PUBLIC_APP_URL: "https://from-env.com" } }),
    ).toBe("https://from-config.com");
  });

  it("falls back to PUBLIC_APP_URL when publicUrl is absent", () => {
    expect(resolveOrigin({ env: { PUBLIC_APP_URL: "https://from-env.com" } })).toBe(
      "https://from-env.com",
    );
  });

  it("throws MissingPublicUrlError when neither is set", () => {
    expect(() => resolveOrigin({ env: {} })).toThrow(MissingPublicUrlError);
  });
});
