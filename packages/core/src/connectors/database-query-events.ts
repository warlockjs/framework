import config from "@mongez/config";
import { servesHttp } from "../application/roles";
import { resolveRequestLogConfig } from "../http/request-log/resolve-request-log-config";
import type { HttpRequestLogConfig } from "../http/request-log/request-log.types";

/**
 * The slot `devtoolsConnector({ production: { enabled: true } })` sets when it
 * is built, so the options passed in `warlock.config.ts` reach core without an
 * import of devtools. A registry symbol: the connector and core may be two
 * module copies.
 */
export const DEVTOOLS_PRODUCTION_REQUESTED = Symbol.for("@warlock.js/devtools.productionRequested");

function devtoolsProductionEnabled(): boolean {
  return (
    config.get("devtools.production.enabled") === true ||
    (globalThis as Record<symbol, unknown>)[DEVTOOLS_PRODUCTION_REQUESTED] === true
  );
}

/**
 * The database configuration handed to the ORM. The request log counts each
 * request's queries from the ORM's query events, which a MongoDB data source
 * emits in production only with `queryEvents: true`. When this process serves
 * HTTP with the request log on and `include.queries` capturing, and the app
 * did not set `queryEvents` itself, it is turned on. It is also turned on in
 * a process that serves HTTP when `devtools.production.enabled` is `true`
 * (the devtools production monitor's Queries tab needs the events), whether it is
 * enabled in config or in the options of `devtoolsConnector()`; in every other case the
 * configuration is passed as it is and the driver's own default applies. An
 * explicit `queryEvents` (true or false) always wins.
 *
 * @internal Used by the database connector; not part of the public API.
 */
export function resolveDatabaseConnectionConfig<T extends object>(databaseConfig: T): T {
  if ((databaseConfig as { queryEvents?: unknown }).queryEvents !== undefined) {
    return databaseConfig;
  }

  // The key and the slot the devtools connector sets; core cannot import devtools.
  if (devtoolsProductionEnabled() && servesHttp()) {
    return { ...databaseConfig, queryEvents: true };
  }

  const requestLog = resolveRequestLogConfig(
    config.get("http.logging.requests") as HttpRequestLogConfig | undefined,
  );

  if (!requestLog.enabled || !requestLog.include.queries || !servesHttp()) {
    return databaseConfig;
  }

  return { ...databaseConfig, queryEvents: true };
}
