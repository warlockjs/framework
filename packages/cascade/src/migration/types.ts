import type { Migration } from "./migration";

/**
 * Result of a single migration execution.
 */
export interface MigrationResult {
  /** Migration name/identifier */
  readonly name: string;
  /** Table/collection affected */
  readonly table: string;
  /** Direction executed */
  readonly direction: "up" | "down";
  /** Whether execution was successful */
  readonly success: boolean;
  /** Error message if failed */
  readonly error?: string;
  /** Execution duration in milliseconds */
  readonly durationMs: number;
  /** Timestamp of execution */
  readonly executedAt: Date;
}

/**
 * Status of a migration file.
 */
export interface MigrationStatus {
  /** Migration name/identifier */
  readonly name: string;
  /** Table/collection affected */
  readonly table: string;
  /** Whether migration has been run */
  readonly executed: boolean;
  /** Batch number (null if not executed) */
  readonly batch: number | null;
  /** Timestamp when executed (null if not executed) */
  readonly executedAt: Date | null;
  /** File path of the migration */
  readonly filePath: string;
}

/**
 * Pending migration ready to be executed.
 */
export interface PendingMigration {
  /** Migration name/identifier */
  readonly name: string;
  /** Table/collection affected */
  readonly table: string;
  /** Migration instance */
  readonly migration: Migration;
  /** File path of the migration */
  readonly filePath: string;
  /** Parsed createdAt timestamp */
  readonly createdAt: Date;
}

/**
 * Record stored in the migrations table.
 */
export interface MigrationRecord {
  /** Migration name/identifier */
  name: string;
  /** Batch number */
  batch: number;
  /** Migration when executed */
  executedAt: Date;
  /** Migration file creation time */
  createdAt: Date;
}

/**
 * Options for the migration runner.
 */
export interface MigrationRunnerOptions {
  /**
   * Glob pattern for finding migration files.
   *
   * @default "**\/*.migration.ts"
   */
  readonly pattern?: string;

  /**
   * Base directory to search for migrations.
   */
  readonly directory: string;

  /**
   * Table/collection name to store migration history.
   *
   * @default "_migrations"
   */
  readonly migrationsTable?: string;

  /**
   * Whether to run in dry-run mode (no actual changes).
   *
   * @default false
   */
  readonly dryRun?: boolean;

  /**
   * Whether to log operations.
   *
   * @default true
   */
  readonly verbose?: boolean;
}

/**
 * Options for running migrations.
 */
export interface RunMigrationsOptions {
  /**
   * Specific migrations to run (by name).
   * If not provided, runs all pending migrations.
   */
  readonly only?: string[];

  /**
   * Run in dry-run mode (no actual changes).
   */
  readonly dryRun?: boolean;
}

/**
 * Options for rolling back migrations.
 */
export interface RollbackOptions {
  /**
   * Number of batches to rollback.
   *
   * @default 1
   */
  readonly batches?: number;

  /**
   * Specific migrations to rollback (by name).
   */
  readonly only?: string[];

  /**
   * Run in dry-run mode (no actual changes).
   */
  readonly dryRun?: boolean;
}
