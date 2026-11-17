import config from "@mongez/config";
import { servesHttp } from "../application/roles";
import { resolveRequestLogConfig } from "../http/request-log/resolve-request-log-config";
import type { HttpRequestLogConfig } from "../http/request-log/request-log.types";

/**
 * The database configuration handed to the ORM. The request log counts each
 * request's queries from the ORM's query events, which a MongoDB data source
 * emits in production only with `queryEvents: true`. When this process serves
 * HTTP with the request log on and `include.queries` capturing, and the app
 * did not set `queryEvents` itself, it is turned on. It is also turned on in
 * a process that serves HTTP when `devtools.production.enabled` is `true`
 * (the devtools production monitor's Queries tab needs the events); in every other case the
 * configuration is passed as it is and the driver's own default applies. An
 * explicit `queryEvents` (true or false) always wins.
 *
 * @internal Used by the database connector; not part of the public API.
 */
export function resolveDatabaseConnectionConfig<T extends object>(databaseConfig: T): T {
  if ((databaseConfig as { queryEvents?: unknown }).queryEvents !== undefined) {
    return databaseConfig;
  }

  // The key the devtools connector reads; core cannot import devtools.
  if (config.get("devtools.production.enabled") === true && servesHttp()) {
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
