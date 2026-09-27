import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

/**
 * The value the logger's redaction substitutes for a censored leaf
 * (`logger/src/redact/redact.ts`, `DEFAULT_CENSOR`). Not exported from
 * `@warlock.js/logger`, so matched by literal here.
 */
const REDACTED_PLACEHOLDER = "[REDACTED]";

function isExplainableSql(sql: string | undefined): boolean {
  return /^\s*(select|with)\b/i.test(sql ?? "");
}

/** Registers the EXPLAIN route: Postgres `SELECT`/`WITH` queries only. */
export function registerExplainRoute(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.post<{ Params: { requestId: string; queryId: string } }>(
    "/api/requests/:requestId/queries/:queryId/explain",
    async (request, reply) => {
      const found = deps.collector.getRequest(request.params.requestId);
      const query = found?.queries.find((item) => item.id === request.params.queryId);

      if (!query) {
        reply.code(404).send();
        return;
      }

      if (query.driver !== "postgres" || !isExplainableSql(query.sql) || !deps.explain) {
        reply.code(400).send({ error: "Only Postgres SELECT or WITH queries can be explained" });
        return;
      }

      if (query.bindings?.some((binding) => binding === REDACTED_PLACEHOLDER)) {
        reply.code(400).send({ error: "bindings redacted" });
        return;
      }

      try {
        const plan = await deps.explain(query);
        return { plan };
      } catch (error) {
        reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}
