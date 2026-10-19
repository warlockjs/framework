import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { JobState, QueueConfig } from "../types";
import type { LocalJob, LocalStore } from "./local-store";

/**
 * The part of `node:sqlite` this store uses. Declared here so apps type-check the
 * shipped source without depending on a particular `@types/node` release.
 * https://nodejs.org/docs/latest-v22.x/api/sqlite.html
 */
type SqliteValue = null | number | bigint | string | Uint8Array;
type SqliteRow = Record<string, unknown>;
type SqliteStatement = {
  all(...parameters: SqliteValue[]): SqliteRow[];
  get(...parameters: SqliteValue[]): SqliteRow | undefined;
  run(...parameters: SqliteValue[]): unknown;
};
type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};
type SqliteModule = { DatabaseSync: new (path: string) => DatabaseSync };

/** node:sqlite is loaded only when the local backend is selected. */
export class SqliteStore implements LocalStore {
  private db: DatabaseSync;
  private namespace: string;

  public constructor(config: QueueConfig) {
    const path = resolve(config.local?.path ?? ".warlock/queue.sqlite");
    if (config.local?.path === ":memory:")
      throw new Error("Use driver: 'memory' for non-durable queues.");
    let sqlite: SqliteModule;
    try {
      sqlite = createRequire(import.meta.url)("node:sqlite") as SqliteModule;
    } catch (cause) {
      throw new Error(
        "The local queue driver requires Node >= 22.15 with node:sqlite available without flags.",
        { cause },
      );
    }
    if (typeof sqlite.DatabaseSync !== "function")
      throw new Error("node:sqlite.DatabaseSync is unavailable.");
    mkdirSync(dirname(path), { recursive: true });
    this.db = new sqlite.DatabaseSync(path);
    this.namespace = config.prefix ?? "warlock";
    try {
      // Use the v22.15 API; constructor timeout options were introduced later.
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS warlock_queue_jobs (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          namespace TEXT NOT NULL, queue TEXT NOT NULL, id TEXT NOT NULL,
          state TEXT NOT NULL, ready_at REAL NOT NULL, lease_until REAL NOT NULL,
          priority INTEGER NOT NULL, body TEXT NOT NULL,
          UNIQUE(namespace, queue, id)
        );
        CREATE INDEX IF NOT EXISTS warlock_queue_ready
          ON warlock_queue_jobs(namespace, queue, state, ready_at, lease_until);
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  public transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public get(queue: string, id: string): LocalJob | undefined {
    return decode(
      this.db
        .prepare("SELECT body FROM warlock_queue_jobs WHERE namespace = ? AND queue = ? AND id = ?")
        .get(this.namespace, queue, id),
    );
  }
  public list(queue: string, state?: JobState): LocalJob[] {
    const rows = state
      ? this.db
          .prepare(
            "SELECT body FROM warlock_queue_jobs WHERE namespace = ? AND queue = ? AND state = ? ORDER BY seq",
          )
          .all(this.namespace, queue, state)
      : this.db
          .prepare(
            "SELECT body FROM warlock_queue_jobs WHERE namespace = ? AND queue = ? ORDER BY seq",
          )
          .all(this.namespace, queue);
    return rows.flatMap((row) => {
      const job = decode(row);
      return job ? [job] : [];
    });
  }
  public ready(queue: string, now: number): LocalJob | undefined {
    return decode(
      this.db
        .prepare(`SELECT body FROM warlock_queue_jobs
      WHERE namespace = ? AND queue = ? AND (
        (state IN ('waiting', 'delayed', 'prioritized') AND ready_at <= ?) OR
        (state = 'active' AND lease_until <= ?)
      ) ORDER BY priority, seq LIMIT 1`)
        .get(this.namespace, queue, now, now),
    );
  }
  public put(job: LocalJob): void {
    this.db
      .prepare(`INSERT INTO warlock_queue_jobs
      (namespace, queue, id, state, ready_at, lease_until, priority, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, queue, id) DO UPDATE SET
        state = excluded.state, ready_at = excluded.ready_at,
        lease_until = excluded.lease_until, priority = excluded.priority, body = excluded.body`)
      .run(
        this.namespace,
        job.queue,
        job.id,
        job.state,
        job.readyAt,
        job.leaseUntil,
        job.priority,
        JSON.stringify(job),
      );
  }
  public remove(queue: string, id: string): void {
    this.db
      .prepare("DELETE FROM warlock_queue_jobs WHERE namespace = ? AND queue = ? AND id = ?")
      .run(this.namespace, queue, id);
  }
  public close(): void {
    this.db.close();
  }
}

function decode(row: Record<string, unknown> | undefined): LocalJob | undefined {
  return typeof row?.body === "string" ? (JSON.parse(row.body) as LocalJob) : undefined;
}
