import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite, type SqliteDatabaseLike } from "./sqlite";

type Snapshot = { runId: string; value: number };

async function hasBuiltinSqlite(): Promise<boolean> {
  try {
    await import(/* @vite-ignore */ "node:sqlite");
    return true;
  } catch {
    return false;
  }
}

const builtin = await hasBuiltinSqlite();

describe("ai.snapshot.sqlite", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-sqlite-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.runIf(builtin)(
    "round-trips snapshots through node:sqlite and survives reopening",
    async () => {
      const path = join(dir, "agent.db");
      const store = sqlite<Snapshot>({ path, table: "snapshots" });

      expect(await store.load("run-1")).toBeUndefined();

      await store.save({ runId: "run-1", value: 1 });
      await store.save({ runId: "run-1", value: 2 });
      await store.save({ runId: "session:chat", value: 3 });

      expect(await store.load("run-1")).toEqual({ runId: "run-1", value: 2 });
      expect(await store.list?.()).toEqual(["run-1", "session:chat"]);
      expect(await store.list?.("session:")).toEqual(["session:chat"]);

      await store.delete("run-1");
      expect(await store.load("run-1")).toBeUndefined();

      const reopened = sqlite<Snapshot>({ path, table: "snapshots" });
      expect(await reopened.load("session:chat")).toEqual({ runId: "session:chat", value: 3 });
      await store.close();
      await reopened.close();
    },
  );

  it.runIf(builtin && process.platform !== "win32")(
    "creates private database and parent directories under umask 0",
    async () => {
      const previous = process.umask(0);

      try {
        const parent = join(dir, "nested", "data");
        const path = join(parent, "agent.db");
        await sqlite<Snapshot>({ path }).save({ runId: "private", value: 1 });
        expect((await stat(join(dir, "nested"))).mode & 0o777).toBe(0o700);
        expect((await stat(parent)).mode & 0o777).toBe(0o700);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      } finally {
        process.umask(previous);
      }
    },
  );

  it.runIf(builtin && process.platform !== "win32")(
    "protects existing database files without changing user directories",
    async () => {
      const path = join(dir, "existing.db");
      await chmod(dir, 0o755);
      await writeFile(path, "", { mode: 0o644 });
      await chmod(path, 0o644);

      await sqlite<Snapshot>({ path }).save({ runId: "private", value: 1 });

      expect((await stat(dir)).mode & 0o777).toBe(0o755);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    },
  );

  it.runIf(builtin && process.platform !== "win32")(
    "keeps WAL and SHM sidecars private under umask 0",
    async () => {
      const previous = process.umask(0);
      const path = join(dir, "wal.db");
      const store = sqlite<Snapshot>({ path });
      // Exercise real SQLite creation: WAL/SHM inherit the database file's mode.
      try {
        const { DatabaseSync } = await import(/* @vite-ignore */ "node:sqlite");
        await store.save({ runId: "initial", value: 1 });
        const database = new DatabaseSync(path);

        try {
          database.exec("PRAGMA journal_mode = WAL");
          await store.save({ runId: "private", value: 2 });
          expect((await stat(`${path}-wal`)).mode & 0o777).toBe(0o600);
          expect((await stat(`${path}-shm`)).mode & 0o777).toBe(0o600);

          // Reopening also repairs sidecars left with permissive modes by another connection.
          await chmod(`${path}-wal`, 0o644);
          await chmod(`${path}-shm`, 0o644);
          await sqlite<Snapshot>({ path }).load("private");
          expect((await stat(`${path}-wal`)).mode & 0o777).toBe(0o600);
          expect((await stat(`${path}-shm`)).mode & 0o777).toBe(0o600);
        } finally {
          database.close();
        }
      } finally {
        process.umask(previous);
      }
    },
  );

  it.runIf(builtin)("keeps in-memory databases in memory", async () => {
    const store = sqlite<Snapshot>({ path: ":memory:" });
    await store.save({ runId: "memory", value: 1 });
    expect(await store.load("memory")).toEqual({ runId: "memory", value: 1 });
  });

  it("uses a caller-supplied database (better-sqlite3 shape) and can skip table creation", async () => {
    const rows = new Map<string, string>();
    const exec = vi.fn();
    const database: SqliteDatabaseLike = {
      exec,
      prepare: (sql) => ({
        run: (...params) => {
          if (sql.startsWith("INSERT")) rows.set(String(params[0]), String(params[1]));
          if (sql.startsWith("DELETE")) rows.delete(String(params[0]));
          return {};
        },
        get: (runId) => {
          const payload = rows.get(String(runId));
          return payload === undefined ? undefined : { payload };
        },
        all: () => [...rows.keys()].sort().map((run_id) => ({ run_id })),
      }),
    };

    const store = sqlite<Snapshot>({ database, createTable: false });
    await store.save({ runId: "a", value: 1 });

    expect(await store.load("a")).toEqual({ runId: "a", value: 1 });
    expect(exec).not.toHaveBeenCalled();

    await sqlite<Snapshot>({ database }).load("a");
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS"));
  });

  it("validates options before touching a database", () => {
    expect(() => sqlite({})).toThrow(/path/);
    expect(() => sqlite({ path: "x.db", table: "bad;name" })).toThrow(/invalid table name/);
    expect(() => sqlite({ database: { exec: "nope" } as unknown as SqliteDatabaseLike })).toThrow(
      /exec\(\) and prepare\(\)/,
    );
    expect(sqlite({ path: "x.db" }).schema()).toContain("run_id TEXT PRIMARY KEY");
  });
});
