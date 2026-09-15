/**
 * 5.12.0 request/locals move — see the CHANGELOG entry and
 * `RequestUserMovedError`.
 *
 * `request.user` was removed from core's `Request` (the authenticated user
 * now lives at `request.locals.user`, written by `@warlock.js/auth`'s
 * middleware). This suite pins the two behaviors core itself still owns:
 *
 * - a development-time diagnostic on the removed `user` getter, so a call
 *   site that still reads it fails loudly instead of silently reading
 *   `undefined`;
 * - `decodedAccessToken`'s cache-mark behavior (`locals.authDerived`), which
 *   is explicitly OUT OF SCOPE for this move and must keep working exactly
 *   as before.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Application } from "../application/application";
import type { Environment } from "../utils";
import { RequestUserMovedError } from "./errors";
import { Request } from "./request";

describe("Request — request.user removal (5.12.0)", () => {
  let originalEnvironment: Environment;

  beforeEach(() => {
    originalEnvironment = Application.environment;
  });

  afterEach(() => {
    Application.setEnvironment(originalEnvironment);
  });

  it("throws RequestUserMovedError naming request.locals.user when read in development", () => {
    Application.setEnvironment("development");

    const request = new Request();

    expect(() => request.user).toThrow(RequestUserMovedError);
    expect(() => request.user).toThrow(/request\.locals\.user/);
  });

  it("does not throw outside development (returns undefined)", () => {
    Application.setEnvironment("production");

    const request = new Request();

    expect(request.user).toBeUndefined();
  });

  it("has no setter — request.user cannot be assigned to", () => {
    const request = new Request();
    const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, "user");

    expect(descriptor?.set).toBeUndefined();
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
