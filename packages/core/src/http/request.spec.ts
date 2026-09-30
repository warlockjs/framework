/**
 * `request.user` was removed from core's `Request` in 5.12.0 (the
 * authenticated user lives at `request.locals.user`, written by
 * `@warlock.js/auth`'s middleware). Its development-time diagnostic getter
 * was removed in 5.26.0, so `Request` has no `user` member at all.
 *
 * `decodedAccessToken`'s cache-mark behavior (`locals.authDerived`) is
 * unrelated to that move and must keep working exactly as before.
 */
import { describe, expect, it } from "vitest";
import { Request } from "./request";

describe("Request — no user member (removed 5.12.0, diagnostic removed 5.26.0)", () => {
  it("declares no user accessor on the prototype", () => {
    expect(Object.getOwnPropertyDescriptor(Request.prototype, "user")).toBeUndefined();
    expect("user" in new Request()).toBe(false);
  });
});

describe("Request — decodedAccessToken cache-mark behavior (out of scope, must keep working)", () => {
  it("marks locals.authDerived when decodedAccessToken is assigned", () => {
    const request = new Request();

    expect(request.locals.authDerived).toBeUndefined();

    request.decodedAccessToken = { userType: "user" };

    expect(request.locals.authDerived).toBe(true);
    expect(request.decodedAccessToken).toEqual({ userType: "user" });
  });
});
