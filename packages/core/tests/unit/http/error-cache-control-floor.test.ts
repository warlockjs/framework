import { afterEach, describe, expect, it } from "vitest";
import { ServerError } from "../../../src/http/errors";
import { bootHarness, type HttpHarness } from "../../integration/http/harness";

/**
 * `handleRequestError` (`src/http/middleware/inject-request-context.ts`) is the
 * single funnel every unhandled error in every Warlock app passes through —
 * `createRequestStore`'s catch routes every throw from middleware/handler here,
 * and core installs no `setErrorHandler` anywhere else. It sets NO
 * `Cache-Control` on any branch, so an unhandled 500 (or a 401/403/404 carrying
 * per-request state) can be stored by a shared cache/CDN and replayed to other
 * requests long after the condition that produced it is gone.
 *
 * The fix adds one unconditional write — `Cache-Control: private, no-store` —
 * at the very top of `handleRequestError`, before any branch runs. This suite
 * proves the floor lands on the delivered response without disturbing any of
 * the three pre-existing `Cache-Control` writers in `response.ts`, and without
 * a normal response picking up a header it never had.
 */

let harness: HttpHarness;

afterEach(async () => {
  await harness?.close();
});

describe("error path Cache-Control floor", () => {
  it("baseline 1: response.stream()'s Cache-Control: no-cache (response.ts:596) is unchanged", async () => {
    harness = await bootHarness((router) => {
      router.get("/stream", ({ response }) => {
        const stream = response.stream();
        stream.send("chunk");
        return stream.end();
      });
    });

    const result = await harness.inject({ method: "GET", url: "/stream" });

    expect(result.headers["cache-control"]).toBe("no-cache");
  });

  it("baseline 2: response.sse()'s Cache-Control: no-cache, no-store, must-revalidate (response.ts:722) is unchanged", async () => {
    harness = await bootHarness((router) => {
      router.get("/sse", ({ response }) => {
        const sse = response.sse();
        sse.send("message", { text: "hi" });
        return sse.end();
      });
    });

    const result = await harness.inject({ method: "GET", url: "/sse" });

    expect(result.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
  });

  it("baseline 3: response.sendBuffer()'s caller-supplied cacheTime value (response.ts:1154) is unchanged", async () => {
    harness = await bootHarness((router) => {
      router.get("/buffer", ({ response }) => {
        return response.sendBuffer(Buffer.from("payload"), { cacheTime: 120 });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/buffer" });

    expect(result.headers["cache-control"]).toBe("public, max-age=120");
  });

  it("baseline 4: a successful ordinary response gains no Cache-Control", async () => {
    harness = await bootHarness((router) => {
      router.get("/ok", ({ response }) => {
        return response.success({ ok: true });
      });
    });

    const result = await harness.inject({ method: "GET", url: "/ok" });

    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBeUndefined();
  });

  it("an errored response carries the private, no-store floor, asserted on the delivered response", async () => {
    harness = await bootHarness((router) => {
      router.get("/boom", () => {
        throw new ServerError("kaboom");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/boom" });

    expect(result.statusCode).toBe(500);
    expect(result.headers["cache-control"]).toBe("private, no-store");
  });

  it("an unrecognised thrown error also carries the floor (the fallback branch)", async () => {
    harness = await bootHarness((router) => {
      router.get("/weird", () => {
        throw new Error("not an HttpError");
      });
    });

    const result = await harness.inject({ method: "GET", url: "/weird" });

    expect(result.statusCode).toBe(500);
    expect(result.headers["cache-control"]).toBe("private, no-store");
  });
});
