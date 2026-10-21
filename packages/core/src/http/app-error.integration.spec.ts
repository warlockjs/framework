import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import type { HttpErrorResponseFormatter } from "./error-response";
import { AppError, ResourceNotFoundError } from "./errors";

let harness: HttpHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.restoreAllMocks();
});

describe("AppError HTTP handling", () => {
  it("sends safe code, message and details without invoking the mapper", async () => {
    const mapper = vi.fn();
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.errorMapper" ? mapper : fallback) as typeof config.get);
    harness = await bootHarness((router) => {
      router.get("/failure", () => {
        throw new AppError("quotaExceeded", 429, "Try again later.", { retryAfter: 30 });
      });
      router.get("/legacy", () => {
        throw new ResourceNotFoundError("Missing");
      });
    });
    const response = await harness.inject({ method: "GET", url: "/failure" });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: { code: "quotaExceeded", message: "Try again later.", details: { retryAfter: 30 } },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(mapper).not.toHaveBeenCalled();
    expect((await harness.inject({ method: "GET", url: "/legacy" })).json()).toMatchObject({
      error: "Missing",
    });
  });

  it("exposes the typed failure to errorResponse, including safe server errors", async () => {
    const formatter: HttpErrorResponseFormatter = ({ appError, body }) =>
      appError
        ? {
            error: {
              code: appError.code,
              message: appError.publicMessage,
              details: appError.details,
            },
          }
        : { original: body };
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.errorResponse" ? formatter : fallback) as typeof config.get);
    harness = await bootHarness((router) => {
      router.get("/unavailable", () => {
        throw new AppError("unavailable", 503, "Temporarily unavailable.", false);
      });
    });
    const response = await harness.inject({ method: "GET", url: "/unavailable" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: "unavailable", message: "Temporarily unavailable.", details: false },
    });
  });

  it("rejects invalid HTTP statuses", () => {
    expect(() => new AppError("invalid", 200, "Invalid")).toThrow(RangeError);
    expect(new AppError("missing", 404, "Missing")).not.toBeInstanceOf(ResourceNotFoundError);
  });
});
