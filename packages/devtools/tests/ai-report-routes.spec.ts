import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "../src/collector";
import { resolveDevtoolsOptions } from "../src/options";
import { DevtoolsApiError } from "../src/production/errors";
import { registerAiReportRoutes } from "../src/server/ai-report-routes";
import type { MountDevtoolsRoutesDeps } from "../src/server/types";

const servers: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function app(extra: Partial<MountDevtoolsRoutesDeps> = {}) {
  const server = Fastify();
  const options = resolveDevtoolsOptions();

  servers.push(server);
  registerAiReportRoutes(server, {
    collector: createCollector(options),
    options,
    isDevelopment: () => true,
    ...extra,
  });

  return server;
}

const view = { available: true, totals: { runs: 1 } };
const service = {
  report: vi.fn(async () => ({ ...view, kind: "report" })),
  models: vi.fn(async () => ({ ...view, kind: "models" })),
  errors: vi.fn(async () => ({ ...view, kind: "errors" })),
};
const reports = { available: true, service, writer: {}, dispose: async () => {} } as never;

describe("AI report routes", () => {
  it("serves each report view with no-store and the query", async () => {
    const server = app({ aiReports: reports });

    for (const route of ["reports", "models", "errors"]) {
      const response = await server.inject({ url: `/api/ai/${route}?range=7d&agent=a&tz=60` });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().available).toBe(true);
    }

    expect(service.report).toHaveBeenCalledWith(
      expect.objectContaining({ range: "7d", agent: "a", tz: "60" }),
    );
  });

  it("answers not-collected without reports, and the unavailable view without dispose", async () => {
    const none = await app().inject({ url: "/api/ai/reports" });

    expect(none.json()).toMatchObject({
      available: false,
      reason: "not-collected",
      command: null,
      detail: null,
    });

    const off = await app({
      aiReports: {
        available: false,
        reason: "table-missing",
        title: "T",
        message: "M",
        command: "warlock migrate",
        detail: null,
        dispose: async () => {},
      },
    }).inject({ url: "/api/ai/models" });

    expect(off.json()).toEqual({
      available: false,
      reason: "table-missing",
      title: "T",
      message: "M",
      command: "warlock migrate",
      detail: null,
    });
  });

  it("answers a known error with its code and status", async () => {
    const failing = {
      ...(reports as object),
      service: {
        ...service,
        report: async () => {
          throw new DevtoolsApiError("ai.range-invalid");
        },
      },
    } as never;
    const response = await app({ aiReports: failing }).inject({ url: "/api/ai/reports?range=x" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "ai.range-invalid" });
  });

  it("serves the evaluate view and grades with POST", async () => {
    const evaluator = {
      view: vi.fn(async () => ({
        available: true,
        configured: true,
        judge: "p/m",
        instructions: "",
        prompts: [],
      })),
      evaluate: vi.fn(async (request: unknown) => {
        if ((request as { runId?: string }).runId === "gone")
          throw new DevtoolsApiError("ai.prompt-not-found");

        return { score: 1, issues: [], judge: "p/m", durationMs: 3 };
      }),
    } as never;
    const server = app({ aiEvaluator: evaluator });

    expect((await server.inject({ url: "/api/ai/evaluate" })).json()).toMatchObject({
      configured: true,
    });

    const ok = await server.inject({
      method: "POST",
      url: "/api/ai/evaluate",
      payload: { systemPrompt: "hi" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.json()).toMatchObject({ score: 1 });

    const gone = await server.inject({
      method: "POST",
      url: "/api/ai/evaluate",
      payload: { runId: "gone" },
    });
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ code: "ai.prompt-not-found" });

    const bad = await server.inject({ method: "POST", url: "/api/ai/evaluate", payload: [] });
    expect(bad.json()).toMatchObject({ code: "input.invalid" });
  });

  it("without an evaluator: GET is not-collected, POST is evaluate-unavailable", async () => {
    const server = app();

    expect((await server.inject({ url: "/api/ai/evaluate" })).json()).toMatchObject({
      reason: "not-collected",
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/ai/evaluate",
      payload: { systemPrompt: "x" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ai.evaluate-unavailable" });
  });

  it("does not register POST evaluate in production", async () => {
    const server = app({ mode: "production" });

    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/ai/evaluate",
          payload: { systemPrompt: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect((await server.inject({ url: "/api/ai/evaluate" })).statusCode).toBe(200);
  });
});
