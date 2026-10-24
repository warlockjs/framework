import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, testWorkerId, workerDatabaseName } from "./reset-test-database";

const driver = vi.hoisted(() => ({
  name: "mongodb",
  blueprint: {
    listTables: vi.fn(async () => ["users", "orders", "_migrations", "system.views", "countries"]),
  },
  truncateTable: vi.fn(async () => 0),
}));
const get = vi.hoisted(() => vi.fn(() => ({ driver })));
vi.mock("@warlock.js/cascade", () => ({ dataSourceRegistry: { get } }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  driver.name = "mongodb";
});

describe("resetTestDatabase", () => {
  it("truncates everything except the ledger, system collections and exclusions", async () => {
    const truncated = await resetTestDatabase({ except: ["countries"], connection: "main" });
    expect(truncated).toEqual(["users", "orders"]);
    expect(get).toHaveBeenCalledWith("main");
    expect(driver.truncateTable).toHaveBeenCalledTimes(2);
    expect(driver.truncateTable).toHaveBeenCalledWith("users", undefined);
  });

  it("limits the reset to `only`", async () => {
    expect(await resetTestDatabase({ only: ["orders", "_migrations"] })).toEqual(["orders"]);
  });

  it("cascades on postgres", async () => {
    driver.name = "postgres";
    await resetTestDatabase({ only: ["users"] });
    expect(driver.truncateTable).toHaveBeenCalledWith("users", { cascade: true });
  });
});

describe("worker identity", () => {
  it("names a database per Vitest worker", () => {
    vi.stubEnv("VITEST_POOL_ID", "3");
    expect(testWorkerId()).toBe(3);
    expect(workerDatabaseName("app_test")).toBe("app_test_3");
  });

  it("falls back to 1 outside a pool", () => {
    vi.stubEnv("VITEST_POOL_ID", "");
    expect(workerDatabaseName("app_test")).toBe("app_test_1");
  });
});
