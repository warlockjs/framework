import { describe, expect, it } from "vitest";
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
        first: async () => ({
          get: (column: string) =>
            ({ data: 1, ttl: 1, expiresAt: Date.now() - 1000 } as Record<string, any>)[column],
        }),
        delete: async (filter: any) => void deleted.push(filter),
      } as any,
    });

    expect(await driver.get("users.1")).toBeNull();
    expect(deleted).toEqual([{ key: "app.users.1" }]);
  });
});
