import { describe, expect, it, vi } from "vitest";
import { createManyRecords } from "../../../src/model/methods/write-methods";
import { Model } from "../../../src/model/model";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class Note extends Model {
  static table = "notes";
  static autoGenerateId = false;
  static createdAtColumn: string | false = "createdAt";
  static updatedAtColumn: string | false = "updatedAt";
}

describe("createMany bulk path leaves the shared driver alone", () => {
  it("a concurrent save() still reaches driver.insert while insertMany is pending", async () => {
    const driver = createMockDriver();
    vi.spyOn(Note, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
    vi.spyOn(Note, "getDriver").mockReturnValue(driver);

    const insertBefore = driver.insert;

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let received: Record<string, unknown>[] = [];

    vi.mocked(driver.insertMany).mockImplementation(async (_table, rows) => {
      received = rows;
      await gate;
      return rows.map(document => ({ document }));
    });

    const bulk = createManyRecords(
      Note as any,
      [{ title: "a" }, { title: "b" }, { title: "c" }],
      { bulk: true },
    );

    // Let the bulk run reach the pending insertMany.
    await vi.waitFor(() => expect(driver.insertMany).toHaveBeenCalledTimes(1));

    expect(driver.insert).toBe(insertBefore);

    const single = new Note({ title: "single" });
    await single.save();

    expect(driver.insert).toBe(insertBefore);
    expect(driver.insert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(driver.insert).mock.calls[0][1]).toMatchObject({ title: "single" });

    release();
    await bulk;

    expect(driver.insert).toBe(insertBefore);
    expect(driver.insert).toHaveBeenCalledTimes(1);
    expect(received.map(row => row.title)).toEqual(["a", "b", "c"]);
  });
});
