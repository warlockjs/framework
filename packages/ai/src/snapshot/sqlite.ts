import { chmod, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { SnapshotStore } from "../contracts/orchestrator/snapshot-store.contract";
import type { SupervisorSnapshot } from "../contracts/supervisor/supervisor-snapshot.type";

/** Default backing table. */
const DEFAULT_TABLE = "warlock_snapshots";

/** Allowed table names: interpolated into SQL, so a conservative identifier subset. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Node's built-in SQLite module. Held in a variable so bundlers and the
 * type checker don't resolve it eagerly; it is only imported on first use.
 */
const SQLITE_MODULE = "node:sqlite";

/** A prepared statement as `node:sqlite` (`StatementSync`) and `better-sqlite3` expose it. */
export type SqliteStatementLike = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

/**
 * The synchronous database surface the store uses. `node:sqlite`'s
 * `DatabaseSync` and a `better-sqlite3` `Database` both satisfy it.
 */
export type SqliteDatabaseLike = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatementLike;
};

/**
 * Options for {@link sqlite}. Pass `path` to open a database with Node's
 * built-in `node:sqlite` (Node 22.5+; no flag needed on Node 22.13+, which
 * prints an experimental-feature warning), or pass an open `database` (for
 * example a `better-sqlite3` instance) on runtimes without it.
 */
export type SqliteSnapshotStoreOptions = {
  /** Database path: 0600 files, new parents 0700 on POSIX. `":memory:"` uses no files. */
  path?: string;
  /** An already-open database. The store never closes it. */
  database?: SqliteDatabaseLike;
  /** Table name. Defaults to `warlock_snapshots`. */
  table?: string;
  /**
   * Run {@link SnapshotStore.schema} (`CREATE TABLE IF NOT EXISTS`) on first
   * use. Default `true` — an embedded database has no separate migration
   * step. Set `false` to manage the table yourself.
   */
  createTable?: boolean;
};

type SqliteModuleLike = { DatabaseSync: new (path: string) => SqliteDatabaseLike };

type SnapshotRow = { payload: string };

/**
 * SQLite {@link SnapshotStore}: one row per `runId` holding the JSON
 * snapshot. Writes are a single `INSERT … ON CONFLICT DO UPDATE`, so a save
 * is atomic. The database opens lazily on the first call.
 */
class SqliteSnapshotStore<TSnapshot extends { runId: string }> implements SnapshotStore<TSnapshot> {
  private database?: Promise<SqliteDatabaseLike>;

  public constructor(
    private readonly options: SqliteSnapshotStoreOptions,
    private readonly table: string,
  ) {}

  public async load(runId: string): Promise<TSnapshot | undefined> {
    const database = await this.open();
    const row = database
      .prepare(`SELECT payload FROM ${this.table} WHERE run_id = ?`)
      .get(runId) as SnapshotRow | undefined;

    return row ? (JSON.parse(row.payload) as TSnapshot) : undefined;
  }

  public async save(snapshot: TSnapshot): Promise<void> {
    const database = await this.open();

    database
      .prepare(
        `INSERT INTO ${this.table} (run_id, payload, updated_at) VALUES (?, ?, ?) ` +
          "ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      )
      .run(snapshot.runId, JSON.stringify(snapshot), new Date().toISOString());
  }

  public async delete(runId: string): Promise<void> {
    const database = await this.open();

    database.prepare(`DELETE FROM ${this.table} WHERE run_id = ?`).run(runId);
  }

  public async list(prefix?: string): Promise<string[]> {
    const database = await this.open();
    const rows = database.prepare(`SELECT run_id FROM ${this.table} ORDER BY run_id`).all() as {
      run_id: string;
    }[];

    return rows
      .map((row) => row.run_id)
      .filter((runId) => prefix === undefined || runId.startsWith(prefix));
  }

  public schema(): string {
    return (
      `CREATE TABLE IF NOT EXISTS ${this.table} (\n` +
      "  run_id TEXT PRIMARY KEY,\n" +
      "  payload TEXT NOT NULL,\n" +
      "  updated_at TEXT NOT NULL\n" +
      ");"
    );
  }

  private open(): Promise<SqliteDatabaseLike> {
    // A failed open is not cached, so the next call can retry.
    this.database ??= this.connect().catch((error: unknown) => {
      this.database = undefined;
      throw error;
    });

    return this.database;
  }

  private async connect(): Promise<SqliteDatabaseLike> {
    const database = this.options.database ?? (await openBuiltin(this.options.path ?? ""));

    if (this.options.createTable !== false) {
      database.exec(this.schema());
    }

    return database;
  }
}

async function openBuiltin(path: string): Promise<SqliteDatabaseLike> {
  let builtin: SqliteModuleLike;

  try {
    builtin = (await import(/* @vite-ignore */ SQLITE_MODULE)) as SqliteModuleLike;
  } catch {
    throw new Error(
      "SQLite snapshot store: this runtime has no built-in 'node:sqlite' (Node 22.5+). " +
        "Pass an open database instead, e.g. ai.snapshot.sqlite({ database: new Database(path) }) " +
        "with the 'better-sqlite3' package.",
    );
  }

  if (path !== ":memory:") {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Create before SQLite opens it: SQLite derives journal/WAL/SHM modes from the database.
    // Verified with node:sqlite on Node 22.15.0 under umask 0 (see sqlite.spec.ts).
    const handle = await open(path, "a", 0o600);

    try {
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }

    // Also protect sidecars left by an earlier connection before accessing their contents.
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        await chmod(`${path}${suffix}`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  return new builtin.DatabaseSync(path);
}

/**
 * Create a SQLite {@link SnapshotStore} for local-first apps: durable agent
 * runs (`durable: { store }`), supervisor snapshots and `ai.session()`
 * conversations in one local file.
 *
 * @example
 * const store = ai.snapshot.sqlite({ path: "./data/agent.db" });
 *
 * @example
 * // A runtime without node:sqlite: bring better-sqlite3.
 * import Database from "better-sqlite3";
 * const store = ai.snapshot.sqlite({ database: new Database("./data/agent.db") });
 */
export function sqlite<TSnapshot extends { runId: string } = SupervisorSnapshot>(
  options: SqliteSnapshotStoreOptions,
): SnapshotStore<TSnapshot> {
  if (!options || (options.database === undefined && !options.path)) {
    throw new Error("SQLite snapshot store requires a 'path' or an open 'database'.");
  }

  if (
    options.database !== undefined &&
    (typeof options.database.exec !== "function" || typeof options.database.prepare !== "function")
  ) {
    throw new Error("SQLite snapshot store: 'database' must provide exec() and prepare().");
  }

  const table = options.table ?? DEFAULT_TABLE;

  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(
      `SQLite snapshot store: invalid table name '${table}'. Allowed: [A-Za-z_][A-Za-z0-9_]*.`,
    );
  }

  return new SqliteSnapshotStore<TSnapshot>(options, table);
}
