import { describe, expect, it } from "vitest";
import { assertSafeRedirectUrl, isSafeRedirectUrl } from "./safe-redirect-url";

describe("isSafeRedirectUrl", () => {
  it.each([
    "/dashboard",
    "dashboard",
    "?tab=2",
    "#top",
    "https://accounts.example.com/oauth/start",
    "http://localhost:3000/x",
    "//cdn.example.com/x",
  ])("accepts %s", (url) => {
    expect(isSafeRedirectUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "/ok\r\nSet-Cookie: x=1",
    "",
    "   ",
  ])("refuses %j", (url) => {
    expect(isSafeRedirectUrl(url)).toBe(false);
  });

  it("throws a clear error from the assert form", () => {
    expect(() => assertSafeRedirectUrl("javascript:alert(1)")).toThrow(
      /only relative, http: and https: URLs are allowed/,
    );
    expect(() => assertSafeRedirectUrl("/fine")).not.toThrow();
  });
});
