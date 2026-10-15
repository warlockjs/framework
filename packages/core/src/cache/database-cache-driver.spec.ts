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
