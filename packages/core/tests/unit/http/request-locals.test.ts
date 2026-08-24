import { describe, expect, it } from "vitest";
import { requestContext, useRequest } from "../../../src/http/context/request-context";
import { Request } from "../../../src/http/request";

/**
 * `request.locals` (design/core-asks-v5.md ask #2) is the private,
 * server-only, per-request data bag — distinct from the input payload
 * (`body`/`query`/`params`/`all()`). It must never surface in
 * `request.all()` / `request.validated()` / `request.input()`, and it must
 * not bleed between concurrent requests.
 *
 * The augmentation below is the exact shape a consumer uses in production —
 * see `v5/app/src/app/auth/utils/session-cookie.ts:50-59` — proving
 * `RequestLocals` is augmentable via `declare module "@warlock.js/core"`
 * from application code, not just from within core itself.
 */
declare module "@warlock.js/core" {
  interface RequestLocals {
    session?: { token: string };
    owner?: string;
  }
}

describe("Request — locals persistence", () => {
  it("persists a written value across multiple reads within the same request", () => {
    const request = new Request();

    request.locals.session = { token: "abc" };

    expect(request.locals.session).toEqual({ token: "abc" });
    // Same object identity on re-read, not a copy.
    expect(request.locals.session).toBe(request.locals.session);
  });

  it("starts as a fresh, empty object per instance — no leakage between two `new Request()` calls", () => {
    const first = new Request();
    first.locals.session = { token: "first-token" };

    const second = new Request();

    expect(second.locals).toEqual({});
    expect(second.locals).not.toBe(first.locals);
  });
});

describe("Request — locals isolation across concurrent request contexts", () => {
  it("does not bleed between two requests running concurrently in AsyncLocalStorage", async () => {
    const runInContext = (label: string) => {
      const request = new Request();

      return requestContext.run({ request, response: undefined } as any, async () => {
        useRequest().locals.owner = label;

        // Yield so the two contexts genuinely interleave before reading back —
        // if `locals` were shared (module-level, not per-instance) this is
        // where the second write would clobber the first.
        await new Promise(resolve => setTimeout(resolve, 10));

        return useRequest().locals.owner;
      });
    };

    const [a, b] = await Promise.all([runInContext("request-a"), runInContext("request-b")]);

    expect(a).toBe("request-a");
    expect(b).toBe("request-b");
  });
});

describe("Request — locals stays out of the input surface", () => {
  it("never surfaces in all(), validated(), or input() — request.set() is the trap, locals is the fix", () => {
    const request = new Request();

    (request as unknown as { payload: Record<string, unknown> }).payload = {
      all: { name: "Sam" },
      body: {},
      query: {},
      params: {},
    };

    request.locals.session = { token: "abc" };
    request.locals.owner = "request-a";
    request.setValidatedData({ name: "Sam" });

    expect(request.all()).toEqual({ name: "Sam" });
    expect(request.all()).not.toHaveProperty("session");
    expect(request.all()).not.toHaveProperty("owner");

    expect(request.validated()).toEqual({ name: "Sam" });
    expect(request.validated()).not.toHaveProperty("session");
    expect(request.validated()).not.toHaveProperty("owner");

    expect(request.input("session")).toBeUndefined();
    expect(request.input("owner")).toBeUndefined();
    expect(request.input("locals")).toBeUndefined();
  });

  it("contrasts with request.set(), which DOES write into the input payload (the trap locals avoids)", () => {
    const request = new Request();

    (request as unknown as { payload: Record<string, unknown> }).payload = {
      all: {},
      body: {},
      query: {},
      params: {},
    };

    request.set("session", { token: "leaked" });

    // request.set() writes the INPUT payload, so it DOES surface here — this
    // is precisely the contamination `request.locals` exists to avoid.
    expect(request.all()).toHaveProperty("session");
  });
});
