import { dataSourceRegistry } from "../data-source/data-source-registry.mjs";
import { MongoDbDriver } from "../drivers/mongodb/mongodb-driver.mjs";
import { PostgresDriver } from "../drivers/postgres/postgres-driver.mjs";
//#region ../../@warlock.js/cascade/src/cli/connection-from-env.ts
const VALID_PRIMARY_KEYS = [
	"uuid",
	"int",
	"bigInt"
];
const VALID_UUID_STRATEGIES = ["v4", "v7"];
const POSTGRES_URL_PREFIXES = ["postgres://", "postgresql://"];
const MONGODB_URL_PREFIXES = ["mongodb://", "mongodb+srv://"];
/**
* Validate and normalise the `CASCADE_PRIMARY_KEY` env var. Throws a CLI-
* shaped error when the value is set but unrecognised.
*/
function parsePrimaryKey(raw) {
	if (!raw) return;
	const trimmed = raw.trim();
	const match = VALID_PRIMARY_KEYS.find((value) => value.toLowerCase() === trimmed.toLowerCase());
	if (!match) throw new Error(`Cascade CLI: invalid CASCADE_PRIMARY_KEY="${raw}". Expected one of ${VALID_PRIMARY_KEYS.join(" | ")}.`);
	return match;
}
/**
* Validate and normalise the `CASCADE_UUID_STRATEGY` env var. Throws a CLI-
* shaped error when the value is set but unrecognised.
*/
function parseUuidStrategy(raw) {
	if (!raw) return;
	const trimmed = raw.trim().toLowerCase();
	const match = VALID_UUID_STRATEGIES.find((value) => value === trimmed);
	if (!match) throw new Error(`Cascade CLI: invalid CASCADE_UUID_STRATEGY="${raw}". Expected one of ${VALID_UUID_STRATEGIES.join(" | ")}.`);
	return match;
}
/**
* Read process env and collapse the alias pairs into a single resolved shape.
*
* Aliases (canonical → also-accepted):
* - `DATABASE_URL` → `DB_URL`
* - `DB_DIALECT` → `DB_DRIVER`
* - `DB_USER` → `DB_USERNAME`
*/
function resolveDbEnv(env) {
	return {
		databaseUrl: env.DATABASE_URL?.trim() || env.DB_URL?.trim() || void 0,
		dialect: env.DB_DIALECT?.trim() || env.DB_DRIVER?.trim() || void 0,
		host: env.DB_HOST?.trim() || void 0,
		port: env.DB_PORT?.toString().trim() || void 0,
		database: env.DB_NAME?.trim() || void 0,
		user: env.DB_USER?.trim() || env.DB_USERNAME?.trim() || void 0,
		password: env.DB_PASSWORD !== void 0 ? String(env.DB_PASSWORD) : void 0,
		primaryKey: parsePrimaryKey(env.CASCADE_PRIMARY_KEY),
		uuidStrategy: parseUuidStrategy(env.CASCADE_UUID_STRATEGY)
	};
}
/**
* Build the optional `migrationDefaults` shape passed to the data source.
* Returns `undefined` when neither env var is set — so consumers get the
* cascade library defaults (`primaryKey: "int"`, `uuidStrategy: "v4"`).
*/
function buildMigrationDefaults(resolved) {
	if (!resolved.primaryKey && !resolved.uuidStrategy) return;
	return {
		primaryKey: resolved.primaryKey,
		uuidStrategy: resolved.uuidStrategy
	};
}
/**
* Parse the path portion of a database URL as the database name, returning
* `undefined` when the URL is malformed or carries no database segment.
*/
function extractDatabaseFromUrl(url) {
	try {
		return new URL(url).pathname.replace(/^\//, "") || void 0;
	} catch {
		return;
	}
}
/**
* Detect the database dialect from env. First inspects the URL scheme, then
* falls back to an explicit `DB_DIALECT` / `DB_DRIVER` env var.
*
* @example
* const dialect = detectDialect();
*/
function detectDialect(env = process.env) {
	const resolved = resolveDbEnv(env);
	if (resolved.databaseUrl) {
		if (POSTGRES_URL_PREFIXES.some((prefix) => resolved.databaseUrl.startsWith(prefix))) return "postgres";
		if (MONGODB_URL_PREFIXES.some((prefix) => resolved.databaseUrl.startsWith(prefix))) return "mongodb";
	}
	const dialect = resolved.dialect?.toLowerCase();
	if (dialect === "postgres" || dialect === "postgresql") return "postgres";
	if (dialect === "mongodb" || dialect === "mongo") return "mongodb";
	throw new Error("Cascade CLI: cannot detect database dialect. Set DATABASE_URL / DB_URL (postgres://… or mongodb://…) or DB_DIALECT / DB_DRIVER = postgres | mongodb.");
}
/**
* Construct a Postgres driver — prefers a connection URL, otherwise builds
* from discrete env vars.
*/
function buildPostgresDriver(resolved) {
	if (resolved.databaseUrl) {
		const database = extractDatabaseFromUrl(resolved.databaseUrl);
		if (!database) throw new Error("Cascade CLI: DATABASE_URL / DB_URL is missing the database name in its path segment.");
		return new PostgresDriver({
			connectionString: resolved.databaseUrl,
			database
		});
	}
	if (!resolved.database) throw new Error("Cascade CLI: missing required env var DB_NAME.");
	return new PostgresDriver({
		host: resolved.host ?? "localhost",
		port: resolved.port ? Number(resolved.port) : 5432,
		database: resolved.database,
		user: resolved.user,
		password: resolved.password
	});
}
/**
* Construct a MongoDB driver — prefers a connection URI, otherwise builds
* from discrete env vars.
*/
function buildMongoDriver(resolved) {
	if (resolved.databaseUrl) {
		const database = resolved.database ?? extractDatabaseFromUrl(resolved.databaseUrl);
		if (!database) throw new Error("Cascade CLI: cannot resolve MongoDB database name. Either include it in DATABASE_URL / DB_URL or set DB_NAME.");
		return new MongoDbDriver({
			uri: resolved.databaseUrl,
			database
		});
	}
	if (!resolved.database) throw new Error("Cascade CLI: missing required env var DB_NAME.");
	return new MongoDbDriver({
		host: resolved.host ?? "localhost",
		port: resolved.port ? Number(resolved.port) : 27017,
		database: resolved.database,
		username: resolved.user,
		password: resolved.password
	});
}
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
async function connectFromEnv(env = process.env) {
	const dialect = detectDialect(env);
	const resolved = resolveDbEnv(env);
	const driver = dialect === "postgres" ? buildPostgresDriver(resolved) : buildMongoDriver(resolved);
	await dataSourceRegistry.register({
		name: "default",
		driver,
		isDefault: true,
		migrationDefaults: buildMigrationDefaults(resolved)
	}).driver.connect();
}
//#endregion
export { connectFromEnv };

//# sourceMappingURL=connection-from-env.mjs.map