import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * `request.locals.authDerived` — set by the `user` and `decodedAccessToken`
 * accessors (`request.ts`), never anywhere else. Two-sided by design: the
 * innocent case (never touched) must read as unmarked, not merely "not yet
 * asserted true".
 */
describe("Request auth-derived mark", () => {
  it("is unmarked on a fresh request that never touches auth state", () => {
    const request = new Request();

    expect(request.locals.authDerived).toBeUndefined();
  });

  it("marks the request when `user` is assigned", () => {
    const request = new Request();

    request.user = { id: 1 } as never;

    expect(request.locals.authDerived).toBe(true);
  });

  it("marks the request when `decodedAccessToken` is assigned", () => {
    const request = new Request();

    request.decodedAccessToken = { userType: "client" };

    expect(request.locals.authDerived).toBe(true);
  });

  it("reads back exactly what was assigned to `user`", () => {
    const request = new Request();
    const user = { id: 42 } as never;

    request.user = user;

    expect(request.user).toBe(user);
  });

  it("reads back exactly what was assigned to `decodedAccessToken`", () => {
    const request = new Request();
    const decoded = { userType: "admin" };

    request.decodedAccessToken = decoded;

    expect(request.decodedAccessToken).toBe(decoded);
  });

  it("stays marked after clearCurrentUser() sets `user` back to undefined", () => {
    const request = new Request();

    request.user = { id: 1 } as never;
    request.clearCurrentUser();

    expect(request.user).toBeUndefined();
    expect(request.locals.authDerived).toBe(true);
  });

  it("marks the request even when clearCurrentUser() is the only auth touch (the logout case)", () => {
    // auth.middleware.ts sets `decodedAccessToken` then calls `clearCurrentUser()`
    // on a valid-signature-but-revoked token, without ever assigning `user`.
    const request = new Request();

    request.decodedAccessToken = { userType: "client" };
    request.clearCurrentUser();

    expect(request.locals.authDerived).toBe(true);
  });
});
