import { mkdtemp, rm } from "node:fs/promises";
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
    },
  );

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
