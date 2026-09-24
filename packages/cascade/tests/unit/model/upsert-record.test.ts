import { v } from "@warlock.js/seal";
import { describe, expect, it, vi } from "vitest";
import { upsertRecord } from "../../../src/model/methods/write-methods";
import { Model } from "../../../src/model/model";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

class Article extends Model {
  static table = "articles";
  static autoGenerateId = false;
  static createdAtColumn: string | false = "createdAt";
  static updatedAtColumn: string | false = "updatedAt";
  static schema = v.object({ email: v.string(), name: v.string() });
}

describe("B9: upsert", () => {
  const driver = createMockDriver();
  // The shared mock driver doesn't stub findOneAndUpdate, which upsert relies on.
  (driver as any).findOneAndUpdate = vi.fn().mockResolvedValue({ id: 1, email: "a@b.c", name: "n" });
  vi.spyOn(Article, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
  vi.spyOn(Article, "getDriver").mockReturnValue(driver);

  it("sets createdAt only on insert, emits saving once, keeps listener changes", async () => {
    let savingRuns = 0;
    Article.events().onSaving((m: Model) => {
      savingRuns++;
      m.set("name", "from-hook");
    });

    await upsertRecord(Article as any, { email: "a@b.c" }, { name: "n" });

    const [, filter, ops, opts] = (driver.findOneAndUpdate as any).mock.calls.at(-1);
    expect(savingRuns).toBe(1);
    expect(filter).toEqual({ email: "a@b.c" });
    expect(ops.$set.createdAt).toBeUndefined();
    expect(ops.$setOnInsert.createdAt).toBeInstanceOf(Date);
    expect(ops.$set.name).toBe("from-hook");
    expect(opts.upsert).toBe(true);
  });

  it("rejects operator-object filters", async () => {
    await expect(
      upsertRecord(Article as any, { email: { $ne: null } } as any, { name: "n" }),
    ).rejects.toThrow();
  });
});
