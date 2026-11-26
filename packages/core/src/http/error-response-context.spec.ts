import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import type { HttpErrorResponseContext } from "./error-response";

let harness: HttpHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.restoreAllMocks();
});

function useFormatter(contexts: HttpErrorResponseContext[]) {
  vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
    key === "http.errorResponse"
      ? (context: HttpErrorResponseContext) => {
          contexts.push(context);

          return { requestId: context.requestId };
        }
      : fallback) as typeof config.get);
}

describe("http.errorResponse context", () => {
  it("carries the request and the thrown error of a failed route", async () => {
    const contexts: HttpErrorResponseContext[] = [];
    useFormatter(contexts);
    const failure = new Error("database down");
    harness = await bootHarness((router) => {
      router.get("/boom", () => {
        throw failure;
      });
    });

    await harness.inject({ method: "GET", url: "/boom" });

    const context = contexts[0]!;

    expect(context.status).toBe(500);
    expect(context.error).toBe(failure);
    expect(context.request?.method).toBe("GET");
    expect(context.request?.id).toBe(context.requestId);
  });

  it("leaves request and error undefined for a reply sent before routing", async () => {
    const contexts: HttpErrorResponseContext[] = [];
    useFormatter(contexts);
    harness = await bootHarness((router) => {
      router.get("/known", () => ({ ok: true }));
    });

    await harness.inject({ method: "GET", url: "/unknown" });

    const context = contexts[0]!;

    expect(context.status).toBe(404);
    expect(context.request).toBeUndefined();
    expect(context.error).toBeUndefined();
  });
});
