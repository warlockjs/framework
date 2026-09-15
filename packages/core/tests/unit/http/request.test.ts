import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * `request.locals.authDerived` — set by the `decodedAccessToken` accessor
 * (`request.ts`), never anywhere else. Two-sided by design: the innocent
 * case (never touched) must read as unmarked, not merely "not yet asserted
 * true".
 *
 * 5.12.0: `request.user` and `clearCurrentUser()` were REMOVED from `Request`
 * — the authenticated user now lives at `request.locals.user`, written by
 * `@warlock.js/auth`'s middleware, which does not mark `authDerived` when it
 * does so (see the 5.12.0 CHANGELOG). `request.user`'s development-time
 * throwing getter (`RequestUserMovedError`) and the `decodedAccessToken`
 * cache-mark behavior below are covered in `src/http/request.spec.ts`.
 */
describe("Request auth-derived mark", () => {
  it("is unmarked on a fresh request that never touches auth state", () => {
    const request = new Request();

    expect(request.locals.authDerived).toBeUndefined();
  });

  it("marks the request when `decodedAccessToken` is assigned", () => {
    const request = new Request();

    request.decodedAccessToken = { userType: "client" };

    expect(request.locals.authDerived).toBe(true);
  });

  it("reads back exactly what was assigned to `decodedAccessToken`", () => {
    const request = new Request();
    const decoded = { userType: "admin" };

    request.decodedAccessToken = decoded;

    expect(request.decodedAccessToken).toBe(decoded);
  });
});
