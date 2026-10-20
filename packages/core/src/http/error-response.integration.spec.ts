import config from "@mongez/config";
import { v } from "@warlock.js/seal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import type { RequestHandler } from "../router/types";
import type { HttpErrorResponseFormatter } from "./error-response";
import { ResourceNotFoundError } from "./errors";

let harness: HttpHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.restoreAllMocks();
});

describe("Warlock errors at the JSON transport boundary", () => {
  it("formats actual schema failures and thrown HttpErrors with the Warlock request ID", async () => {
    const formatter: HttpErrorResponseFormatter = ({ status, body, requestId }) => ({
      error: { code: `http${status}`, message: "Request failed." },
      details: body,
      requestId,
    });
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.errorResponse" ? formatter : fallback) as typeof config.get);
    const handler: RequestHandler = ({ response }) => response.success({ reached: true });
    handler.validation = { params: v.object({ id: v.string().uuid() }) };
    harness = await bootHarness((router) => {
      router.get("/validated/:id", handler);
      router.get("/missing-resource", () => {
        throw new ResourceNotFoundError("Missing resource");
      });
    });

    const invalid = await harness.inject({
      method: "GET",
      url: "/validated/invalid",
      headers: { "x-request-id": "warlock-request-1" },
    });
    const missing = await harness.inject({
      method: "GET",
      url: "/missing-resource",
      headers: { "x-request-id": "warlock-request-2" },
    });

    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: { code: "http422" },
      requestId: "warlock-request-1",
      details: { errors: [{ input: "id" }] },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: "http404" },
      requestId: "warlock-request-2",
      details: { error: "Missing resource" },
    });
    expect(invalid.headers["x-request-id"]).toBe("warlock-request-1");
    expect(missing.headers["x-request-id"]).toBe("warlock-request-2");
  });
});
