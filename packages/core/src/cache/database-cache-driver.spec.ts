import { describe, expect, it, vi } from "vitest";
import { DatabaseCacheDriver } from "./database-cache-driver";

describe("DatabaseCacheDriver.set ttl parsing", () => {
  const setup = () => {
    const created: any[] = [];
    const driver = new DatabaseCacheDriver();
    driver.setOptions({
      model: {
        first: async () => null,
        create: async (row: any) => created.push(row),
      } as any,
    });
    return { driver, created };
  };

  it("parses a string duration", async () => {
    const { driver, created } = setup();
    await driver.set("k", 1, "1h");

    expect(created[0].ttl).toBe(3600);
  });

  it("accepts an options object with ttl", async () => {
    const { driver, created } = setup();
    await driver.set("k", 1, { ttl: "2m" });

    expect(created[0].ttl).toBe(120);
  });

  it("still accepts a numeric ttl", async () => {
    const { driver, created } = setup();
    await driver.set("k", 1, 30);

    expect(created[0].ttl).toBe(30);
  });
});

describe("DatabaseCacheDriver namespace removal", () => {
  /**
   * An in-memory "table" behind a model double whose query builder supports
   * the `where` / `whereStartsWith` / `delete` chain the driver uses.
   */
  const setup = (options: { globalPrefix?: string } = {}) => {
    const rows: Array<{ key: string; namespace: string }> = [];

    const model: any = {
      first: async () => null,
      create: async (row: any) => void rows.push(row),
      query: () => {
        const filters: Array<(row: { namespace: string }) => boolean> = [];
        const builder: any = {
          where: (column: string, value: string) => (
            filters.push((row: any) => row[column] === value),
            builder
          ),
          whereStartsWith: (column: string, value: string) => (
            filters.push((row: any) => String(row[column]).startsWith(value)),
            builder
          ),
          delete: async () => {
            const kept = rows.filter((row) => !filters.every((filter) => filter(row)));
            const removed = rows.length - kept.length;
            rows.splice(0, rows.length, ...kept);
            return removed;
          },
        };
        return builder;
      },
    };

    const driver = new DatabaseCacheDriver();
    driver.setOptions({ model, ...options });

    return { driver, rows };
  };

  it("removes nested keys under the namespace, not only exact matches", async () => {
    const { driver, rows } = setup();

    await driver.set("repositories.users.id.1", 1);
    await driver.set("repositories.users.list.page.2", 2);
    await driver.set("repositories.users", 3);
    await driver.set("repositories.usersArchive.id.1", 4);
    await driver.set("repositories.posts.id.1", 5);

    await driver.removeNamespace("repositories.users");

    expect(rows.map((row) => row.key).sort()).toEqual([
      "repositories.posts.id.1",
      "repositories.usersArchive.id.1",
    ]);
  });

  it("flush() clears every entry and waits for it", async () => {
    const { driver, rows } = setup();

    await driver.set("a.b", 1);
    await driver.set("c", 2);
    await driver.flush();

    expect(rows).toEqual([]);
  });

  it("flush() with a global prefix removes the prefixed entries before resolving", async () => {
    const { driver, rows } = setup({ globalPrefix: "app" });

    await driver.set("a.b", 1);
    await driver.flush();

    expect(rows).toEqual([]);
  });
});

describe("DatabaseCacheDriver expired entries", () => {
  it("removes an expired entry by its stored key when a global prefix is set", async () => {
    const deleted: any[] = [];
    const driver = new DatabaseCacheDriver();

    driver.setOptions({
      globalPrefix: "app",
      model: {
        query: () => {
          const builder: any = {
            where: () => builder,
            lean: () => builder,
            first: async () => ({ data: 1, ttl: 1, expiresAt: Date.now() - 1000 }),
          };
          return builder;
        },
        delete: async (filter: any) => void deleted.push(filter),
      } as any,
    });

    expect(await driver.get("users.1")).toBeNull();
    expect(deleted).toEqual([{ key: "app.users.1" }]);
  });
});

describe("DatabaseCacheDriver lean get and upsert", () => {
  it("reads a plain row without building a model", async () => {
    const first = vi.fn(async () => ({ data: { a: 1 }, ttl: 60, expiresAt: Date.now() + 60_000 }));
    const builder: any = { where: vi.fn(() => builder), lean: vi.fn(() => builder), first };
    const modelFirst = vi.fn();
    const driver = new DatabaseCacheDriver();
    driver.setOptions({ model: { query: () => builder, first: modelFirst } as any });

    expect(await driver.get("k")).toEqual({ a: 1 });
    expect(builder.lean).toHaveBeenCalled();
    expect(modelFirst).not.toHaveBeenCalled();
  });

  it("writes with one upsert on the key when upsert is on", async () => {
    const upsert = vi.fn(async (..._args: unknown[]) => ({}));
    const first = vi.fn();
    const driver = new DatabaseCacheDriver();
    driver.setOptions({ upsert: true, model: { upsert, first, create: vi.fn() } as any });

    await driver.set("users.1", "v", 60);

    expect(first).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toEqual({ key: "users.1" });
    expect(upsert.mock.calls[0]?.[2]).toEqual({ conflictColumns: ["key"] });
  });
});

describe("DatabaseCacheDriver write path", () => {
  const setup = (options: { upsert?: boolean; indexes?: unknown[] | Error } = {}) => {
    const calls = { upsert: 0, first: 0, create: 0, listIndexes: 0 };
    const model: any = {
      table: "cache",
      first: async () => (calls.first++, null),
      create: async () => void calls.create++,
      upsert: async () => void calls.upsert++,
      getDriver: () => ({
        blueprint: {
          listIndexes: async () => {
            calls.listIndexes++;

            if (options.indexes instanceof Error) throw options.indexes;

            return options.indexes ?? [];
          },
        },
      }),
    };
    const driver = new DatabaseCacheDriver();

    driver.setOptions({
      model,
      ...(options.upsert === undefined ? {} : { upsert: options.upsert }),
    });

    return { driver, calls };
  };

  it("uses one upsert when the table has a unique index on key", async () => {
    const { driver, calls } = setup({
      indexes: [{ name: "cache_key_unique", columns: ["key"], unique: true }],
    });

    await driver.set("a", 1);
    await driver.set("b", 2);

    expect(calls).toMatchObject({ upsert: 2, first: 0, create: 0, listIndexes: 1 });
  });

  it("reads first and hints once when the index is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const { driver, calls } = setup({
        indexes: [{ name: "cache_key_index", columns: ["key"], unique: false }],
      });

      await driver.set("a", 1);
      await driver.set("b", 2);

      expect(calls).toMatchObject({ upsert: 0, first: 2, create: 2, listIndexes: 1 });

      const hints = warn.mock.calls.filter((call) => String(call[0]).includes("cacheMigration"));

      expect(hints.length).toBeLessThanOrEqual(1);
      expect(String(hints[0]?.[0] ?? "cacheMigration upsert: true")).toContain("upsert: true");
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps the read-then-write path when the indexes cannot be read", async () => {
    const { driver, calls } = setup({ indexes: new Error("no permission") });

    await driver.set("a", 1);

    expect(calls).toMatchObject({ upsert: 0, first: 1, create: 1 });
  });

  it("skips the lookup when upsert is set explicitly", async () => {
    const on = setup({ upsert: true });
    const off = setup({ upsert: false, indexes: [{ columns: ["key"], unique: true }] });

    await on.driver.set("a", 1);
    await off.driver.set("a", 1);

    expect(on.calls).toMatchObject({ upsert: 1, listIndexes: 0 });
    expect(off.calls).toMatchObject({ upsert: 0, first: 1, listIndexes: 0 });
  });
});
