import { describe, expect, it } from "vitest";
import { isSafeRedirect, safeRedirect } from "./safe-redirect";

const allowedOrigins = ["https://app.example.com", "http://localhost:3000/"];

describe("safeRedirect", () => {
  it.each(["/", "/dashboard", "/posts/1?tab=2#comments", "/search?q=a%2F%2Fb"])(
    "follows the same-origin path %s",
    (target) => {
      expect(isSafeRedirect(target)).toBe(true);
      expect(safeRedirect(target)).toBe(target);
    },
  );

  it.each([
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/login"],
    ["backslash host", "/\\evil.com"],
    ["backslash later in the path", "/x\\..\\\\evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["mixed-case javascript scheme", "JaVaScRiPt:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["absolute URL not allowed", "https://evil.com/"],
    ["relative path without slash", "dashboard"],
    ["query only", "?tab=2"],
    ["tab inside a scheme", "java\tscript:alert(1)"],
    ["newline header splitting", "/ok\r\nSet-Cookie: a=b"],
    ["leading whitespace", " /dashboard"],
    ["empty", ""],
  ])("refuses %s", (_label, target) => {
    expect(isSafeRedirect(target)).toBe(false);
    expect(safeRedirect(target)).toBe("/");
  });

  it.each([undefined, null, 42, ["/x"], { url: "/x" }])("refuses the non-string %j", (target) => {
    expect(isSafeRedirect(target)).toBe(false);
    expect(safeRedirect(target, { fallback: "/home" })).toBe("/home");
  });

  it("follows absolute http(s) URLs whose origin is allowed", () => {
    expect(safeRedirect("https://app.example.com/billing?x=1", { allowedOrigins })).toBe(
      "https://app.example.com/billing?x=1",
    );
    expect(safeRedirect("http://localhost:3000/", { allowedOrigins })).toBe(
      "http://localhost:3000/",
    );
  });

  it("compares parsed origins, not string prefixes", () => {
    for (const target of [
      "https://app.example.com.evil.com/",
      "https://app.example.com@evil.com/",
      "http://app.example.com/",
      "https://app.example.com:8443/",
      "https://user:pass@app.example.com/",
      "http://localhost:3001/",
    ]) {
      expect(isSafeRedirect(target, { allowedOrigins })).toBe(false);
    }
  });

  it("ignores allowed-origin entries that are not http(s) URLs", () => {
    expect(isSafeRedirect("javascript:alert(1)", { allowedOrigins: ["javascript:alert(1)"] })).toBe(
      false,
    );
    expect(isSafeRedirect("https://a.com/", { allowedOrigins: ["not a url"] })).toBe(false);
  });

  it("uses the configured fallback", () => {
    expect(safeRedirect("//evil.com", { fallback: "/login" })).toBe("/login");
  });
});
