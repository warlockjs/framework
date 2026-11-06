import { describe, expect, it, vi } from "vitest";
import { createInMemoryDriver } from "./in-memory-driver";

vi.mock("@warlock.js/cascade", () => ({}));

import { resetSeedLedger } from "../../../../src/database/seeds/reset-seed-ledger";
import { seedRecordsTableName, seedsTableName } from "../../../../src/database/seeds/utils";

describe("resetSeedLedger", () => {
  it("empties the seed log and the tracked records", async () => {
    const memory = createInMemoryDriver();
    memory.createTable(seedsTableName);
    memory.createTable(seedRecordsTableName);
    memory.driver.insert(seedsTableName, { name: "users", runCount: 1 });
    memory.driver.insert(seedRecordsTableName, { seeder: "users", table: "users", recordId: 1 });

    await resetSeedLedger({ driver: memory.driver } as any);

    expect(memory.rowsOf(seedsTableName)).toHaveLength(0);
    expect(memory.rowsOf(seedRecordsTableName)).toHaveLength(0);
  });

  it("does nothing when the ledger tables do not exist", async () => {
    const memory = createInMemoryDriver();

    await resetSeedLedger({ driver: memory.driver } as any);

    expect(memory.driver.deleteMany).not.toHaveBeenCalled();
  });
});
