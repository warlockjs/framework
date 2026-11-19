import type { FastifyInstance, FastifyReply } from "fastify";
import type { DevtoolsAiRangeQuery } from "../ai/reports/range";
import { DevtoolsApiError } from "../production/errors";
import { describeAiUnavailable, toAiUnavailableView } from "../sources/ai-source";
import type { MountDevtoolsRoutesDeps } from "./types";

/** The answer of a route whose data source is not wired in this mode. */
const notCollected = () => toAiUnavailableView(describeAiUnavailable("not-collected"));

/** Sends a known failure as the dashboard's error body; anything else goes to the error handler. */
function sendKnown(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DevtoolsApiError) return reply.code(error.statusCode).send(error.toBody());

  throw error;
}

/**
 * The AI section's report routes, inside the same guard as every panel
 * (development loopback guard, or the production session and access table):
 *
 * - `GET /api/ai/reports` → `DevtoolsAiReportView`
 * - `GET /api/ai/models` → `DevtoolsAiModelsView`
 * - `GET /api/ai/errors` → `DevtoolsAiErrorsView`
 * - `GET /api/ai/evaluate` → `DevtoolsAiEvaluateView`
 * - `POST /api/ai/evaluate` → `DevtoolsAiEvaluateResult` (development only)
 *
 * Every answer is `Cache-Control: no-store`. Without `deps.aiReports` the
 * report routes answer the `not-collected` view; with an unavailable one they
 * answer it. Without `deps.aiEvaluator` both evaluate routes answer
 * `not-collected` (GET) / `ai.evaluate-unavailable` (POST).
 */
export function registerAiReportRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  for (const [route, view] of [
    ["/api/ai/reports", "report"],
    ["/api/ai/models", "models"],
    ["/api/ai/errors", "errors"],
  ] as const) {
    server.get<{ Querystring: DevtoolsAiRangeQuery }>(route, async (request, reply) => {
      reply.header("Cache-Control", "no-store");

      const reports = deps.aiReports;

      if (!reports) return notCollected();

      if (!reports.available) {
        const { dispose: _dispose, ...unavailable } = reports;

        return unavailable;
      }

      try {
        return await reports.service[view](request.query);
      } catch (error) {
        return sendKnown(reply, error);
      }
    });
  }

  server.get("/api/ai/evaluate", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    if (!deps.aiEvaluator) return notCollected();

    return deps.aiEvaluator.view();
  });

  // Evaluate spends a model call and reads prompt text: it exists in development only.
  if (deps.mode === "production") return;

  server.post<{ Body: unknown }>("/api/ai/evaluate", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    try {
      if (!deps.aiEvaluator) throw new DevtoolsApiError("ai.evaluate-unavailable");

      const body = request.body;

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new DevtoolsApiError("input.invalid");
      }

      const { runId, systemPrompt, instructions } = body as Record<string, unknown>;

      return await deps.aiEvaluator.evaluate({
        ...(runId === undefined ? {} : { runId: runId as string }),
        ...(systemPrompt === undefined ? {} : { systemPrompt: systemPrompt as string }),
        ...(instructions === undefined ? {} : { instructions: instructions as string }),
      });
    } catch (error) {
      return sendKnown(reply, error);
    }
  });
}
