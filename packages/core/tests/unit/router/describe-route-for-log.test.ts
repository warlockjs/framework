import { describe, expect, it } from "vitest";
import { describeRouteForLog } from "../../../src/router/describe-route-for-log";

/*
  The defect: the label was `method + " " + path.replace("/*", "")`. Stripping
  the wildcard is right for `/products/*`, which should read as `/products`.
  For the BARE catch-all `/*` it leaves the empty string, and the log says:

      [route] [GET ]  Completed Request: k1Nd… — 404 in 22ms

  Cosmetic on its own, and it survived a long time because it appeared once per
  request. The completion line doubled that.
*/

describe("describeRouteForLog", () => {
  it("strips a trailing wildcard from a prefixed route", () => {
    expect(describeRouteForLog("GET", "/products/*")).toBe("GET /products");
  });

  it("leaves an ordinary path alone", () => {
    expect(describeRouteForLog("POST", "/auth/login")).toBe("POST /auth/login");
  });

  it("leaves the root alone", () => {
    expect(describeRouteForLog("GET", "/")).toBe("GET /");
  });

  it("keeps the catch-all legible instead of blanking it", () => {
    // `/*` is the route's own declared path, and the reader is looking for
    // which route matched — so show it rather than an empty space.
    expect(describeRouteForLog("GET", "/*")).toBe("GET /*");
  });

  it("never produces a label ending in a bare space", () => {
    for (const path of ["/*", "/", "/products/*", "/products"]) {
      expect(describeRouteForLog("GET", path)).not.toMatch(/\s$/);
    }
  });

  it("only strips the wildcard at the END, not one in the middle", () => {
    // A path segment is never literally "/*" mid-route today, but `replace`
    // removes the FIRST occurrence wherever it sits — which would silently
    // rewrite the route if one ever appeared.
    expect(describeRouteForLog("GET", "/a/*/b")).toBe("GET /a/*/b");
  });
});
