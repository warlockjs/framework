import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * `request.nonce` (design/core-asks-v5.md ask #2) is the per-request CSP
 * nonce the web layer hands to `<Scripts nonce={...} />` AND to the
 * `Content-Security-Policy` header (`v5/app/src/web/middleware/base.middleware.ts:76`
 * — `shared.nonce = request.nonce`, typed as a plain `string` there). It must
 * be stable across repeated reads within one request (the header and the
 * inline script tag must agree), but differ across requests (a reused nonce
 * defeats the point of a nonce-based CSP).
 */
describe("Request — nonce", () => {
  it("is stable across multiple reads within the same request", () => {
    const request = new Request();

    const first = request.nonce;
    const second = request.nonce;

    expect(first).toBe(second);
  });

  it("differs across two request instances", () => {
    const a = new Request();
    const b = new Request();

    expect(a.nonce).not.toBe(b.nonce);
  });

  it("is base64-encoded 16 random bytes", () => {
    const request = new Request();

    // 16 bytes -> 24 base64 characters (including "==" padding).
    expect(request.nonce).toHaveLength(24);
    expect(request.nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(request.nonce, "base64")).toHaveLength(16);
  });

  it("is generated lazily — unset until the first `nonce` read", () => {
    const request = new Request();

    expect((request as unknown as { _nonce?: string })._nonce).toBeUndefined();

    void request.nonce;

    expect((request as unknown as { _nonce?: string })._nonce).toBe(request.nonce);
  });
});
