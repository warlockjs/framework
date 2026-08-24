import { describe, expect, it } from "vitest";
import { requestContext } from "../../../src/http/context/request-context";
import { requestMemo } from "../../../src/http/context/request-memo";

/**
 * `requestMemo` is built on `requestContext` (core/src/http/context/request-context.ts),
 * itself an `@warlock.js/context` `Context` — an AsyncLocalStorage wrapper
 * (context/src/base-context.ts). Tests drive the real store via
 * `requestContext.run(store, callback)`, exactly what
 * `core/src/http/middleware/inject-request-context.ts`'s `createRequestStore`
 * does for a live HTTP request.
 */
function withRequestContext<T>(callback: () => Promise<T>) {
  return requestContext.run({ request: undefined, response: undefined } as any, callback);
}

describe("requestMemo", () => {
  it("runs fn once for two calls with the same key, both getting the same result", async () => {
    let calls = 0;

    await withRequestContext(async () => {
      const fn = async () => {
        calls++;
        return { value: "result" };
      };

      const [a, b] = await Promise.all([requestMemo("key", fn), requestMemo("key", fn)]);

      expect(calls).toBe(1);
      expect(a).toBe(b);
      expect(a).toEqual({ value: "result" });
    });
  });

  it("single-flights: a second call issued while the first is still pending gets the SAME promise", async () => {
    let resolveFn: (value: string) => void;
    let calls = 0;

    await withRequestContext(async () => {
      const fn = () =>
        new Promise<string>(resolve => {
          calls++;
          resolveFn = resolve;
        });

      const first = requestMemo("in-flight-key", fn);
      const second = requestMemo("in-flight-key", fn);

      // Still pending — fn must have only run once, and both callers must
      // hold the exact same promise instance (not two promises that happen
      // to resolve to the same value).
      expect(calls).toBe(1);
      expect(first).toBe(second);

      resolveFn!("done");

      await expect(first).resolves.toBe("done");
      await expect(second).resolves.toBe("done");
    });
  });

  it("runs fn separately for different keys", async () => {
    const calls: string[] = [];

    await withRequestContext(async () => {
      const makeFn = (key: string) => async () => {
        calls.push(key);
        return key;
      };

      const a = await requestMemo("key-a", makeFn("key-a"));
      const b = await requestMemo("key-b", makeFn("key-b"));

      expect(a).toBe("key-a");
      expect(b).toBe("key-b");
      expect(calls).toEqual(["key-a", "key-b"]);
    });
  });

  it("isolates the same key across two concurrent request contexts (no bleed)", async () => {
    const seen: Record<string, number> = {};

    const runInContext = (label: string) =>
      requestContext.run({ request: undefined, response: undefined } as any, async () => {
        return requestMemo("shared-key", async () => {
          seen[label] = (seen[label] || 0) + 1;
          // Yield so the two contexts genuinely interleave.
          await new Promise(resolve => setTimeout(resolve, 10));
          return label;
        });
      });

    const [resultA, resultB] = await Promise.all([runInContext("request-a"), runInContext("request-b")]);

    expect(resultA).toBe("request-a");
    expect(resultB).toBe("request-b");
    expect(seen).toEqual({ "request-a": 1, "request-b": 1 });
  });

  it("does not cache a rejection: the next call re-executes and can succeed", async () => {
    let attempt = 0;

    await withRequestContext(async () => {
      const fn = async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error("first attempt fails");
        }
        return "second attempt succeeds";
      };

      await expect(requestMemo("retry-key", fn)).rejects.toThrow("first attempt fails");

      expect(attempt).toBe(1);

      await expect(requestMemo("retry-key", fn)).resolves.toBe("second attempt succeeds");

      expect(attempt).toBe(2);
    });
  });

  it("throws loudly, naming requestMemo, when called outside a request context", async () => {
    // No requestContext.run() wrapping this call.
    expect(() => requestMemo("no-context-key", async () => "value")).toThrow(/requestMemo/);
  });
});
