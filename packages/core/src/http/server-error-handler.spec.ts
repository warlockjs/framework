import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";

/**
 * 5xx errors that reach the server without going through the request
 * funnel must not put their message (driver errors, hosts, file paths) in
 * the response body.
 */
describe("server error handler", () => {
  let harness: HttpHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it("keeps a 500 opaque when the returned value's toJSON throws", async () => {
    harness = await bootHarness((router) => {
      router.get("/broken", () => ({
        toJSON() {
          throw new Error("secret detail");
        },
      }));
    });

    const result = await harness.inject({ method: "GET", url: "/broken" });

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain("secret detail");
    expect(harness.json(result)).toMatchObject({ error: "Internal server error." });
    expect(result.headers["cache-control"]).toBe("private, no-store");
  });

  it("keeps a 500 opaque when an Error is sent as the body", async () => {
    harness = await bootHarness((router) => {
      router.get("/outage", ({ response }) =>
        response.serverError(new Error("connect ECONNREFUSED 10.0.3.12:27017")),
      );
    });

    const result = await harness.inject({ method: "GET", url: "/outage" });

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain("ECONNREFUSED");
    expect(result.body).not.toContain("10.0.3.12");
  });

  it("keeps the descriptive body of a client error", async () => {
    harness = await bootHarness((router) => {
      router.post("/echo", ({ response }) => response.success({ ok: true }));
    });

    const result = await harness.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(result.statusCode).toBe(400);
    expect(harness.json(result).message).toBeTruthy();
  });
});
