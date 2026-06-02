/**
 * Supported database dialects for the standalone Cascade CLI.
 */
export type CliDialect = "postgres" | "mongodb";
/**
 * Detect the database dialect from env. First inspects the URL scheme, then
 * falls back to an explicit `DB_DIALECT` / `DB_DRIVER` env var.
 *
 * @example
 * const dialect = detectDialect();
 */
export declare function detectDialect(env?: NodeJS.ProcessEnv): CliDialect;
/**
 * Register a `default` data source on `dataSourceRegistry` derived entirely
 * from environment variables and open the underlying driver connection.
 *
 * Reads (canonical name → accepted aliases):
 * - `DATABASE_URL` → `DB_URL` (preferred when present)
 * - `DB_DIALECT` → `DB_DRIVER` (needed only when no URL)
 * - `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_PASSWORD` (no aliases)
 * - `DB_USER` → `DB_USERNAME`
 *
 * Optional migration defaults — affect how `Migration.create()` chooses the
 * primary-key column and which UUID function the driver emits. Unset means
 * the cascade library defaults apply (`primaryKey: "int"`, `uuidStrategy:
 * "v4"`).
 * - `CASCADE_PRIMARY_KEY` — `uuid` | `int` | `bigInt`
 * - `CASCADE_UUID_STRATEGY` — `v4` | `v7`
 *
 * The driver's pool/socket is opened before this function returns, so the
 * caller can issue queries immediately. Pair every call with
 * `disconnect()` (or use `withCliConnection`) so the process exits cleanly.
 *
 * @example
 * await connectFromEnv();
 * const results = await runMigrations();
 */
export declare function connectFromEnv(env?: NodeJS.ProcessEnv): Promise<void>;
//# sourceMappingURL=connection-from-env.d.ts.map