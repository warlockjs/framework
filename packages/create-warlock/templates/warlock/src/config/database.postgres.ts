import type { ConnectionOptions, PostgresPoolConfig } from "@warlock.js/cascade";
import { env } from "@warlock.js/core";

// Each Vitest worker keeps its own database and truncates it between test files
// (src/config/tests.ts), so tests run against "<DB_NAME>_test_<worker id>". Create one
// database per worker first (for example <DB_NAME>_test_1 to _4, one per `maxWorkers`) and
// run the migrations on each.
const databaseName = process.env.VITEST
  ? `${env("DB_NAME", "app")}_test_${process.env.VITEST_POOL_ID ?? 1}`
  : env("DB_NAME");

const databaseConfigurations: ConnectionOptions<never, PostgresPoolConfig> = {
  driver: env("DB_DRIVER", "postgres"),
  name: "default",
  database: databaseName,
  host: env("DB_HOST", "localhost"),
  port: env("DB_PORT", 5432),
  username: env("DB_USERNAME"),
  password: env("DB_PASSWORD"),
  uri: env("DB_URL"),

  defaultDeleteStrategy: "permanent",

  clientOptions: {
    // `PostgresPoolConfig` extends the connection config, so `database` is
    // required here too even though it duplicates the top-level value above.
    database: databaseName,

    // Native `pg` pool options — tune these for your workload.
    // max: 10,
    // min: 0,
    // idleTimeoutMillis: 10000,
  },

  // ============================================================================
  // Model Defaults Configuration
  // ============================================================================
  // These settings override driver defaults and apply to all models.
  // Individual models can override these by setting static properties.
  //
  // Configuration hierarchy (highest to lowest):
  // 1. Model static property (e.g., User.createdAtColumn = "creation_date")
  // 2. modelOptions (below) - Database-wide overrides
  // 3. Driver defaults (PostgreSQL: snake_case, MongoDB: camelCase)
  // 4. Framework defaults
  // ============================================================================
  modelOptions: {
    // Timestamps - PostgreSQL driver already defaults to snake_case
    // (created_at, updated_at) so these are optional unless overriding
    timestamps: true,
    // createdAtColumn: "created_at", // Already driver default
    // updatedAtColumn: "updated_at", // Already driver default

    // Deletion Strategy
    // deleteStrategy: "soft", // Uncomment to enable soft deletes globally
    // deletedAtColumn: "deleted_at", // Already driver default

    // Validation
    strictMode: "strip",

    // Naming Convention
    // namingConvention: "snake_case", // Already driver default for PostgreSQL
  },
};

export default databaseConfigurations;
