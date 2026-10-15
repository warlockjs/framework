import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { createMockDriver } from "../../utils/test-helpers";
import { Model } from "../../../src/model/model";
import { SyncManager } from "../../../src/sync/sync-manager";

class SyncUser extends Model {
  static table = "sync_users";
  static hidden = ["password"];
}

const manager = () => new SyncManager(SyncUser as any, {} as any) as any;

describe("SyncManager — default embed", () => {
  // Model construction asks the driver for a dirty tracker, so a default data source is required.
  beforeAll(() => {
    dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
  });

  afterAll(() => {
    dataSourceRegistry.clear();
  });

  it("omits hidden fields (password hash) from the embedded doc", async () => {
    const user = new SyncUser({ id: 1, name: "Ada", password: "$2b$hash" });

    const embedded = await manager().getEmbedData(user, { embedKey: "embedData" });

    expect(embedded.name).toBe("Ada");
    expect(embedded).not.toHaveProperty("password");
  });
});

describe("SyncManager — unsetOnDelete on many-relations", () => {
  const base = { targetModelClass: { table: "posts", name: "Post" }, identifierField: "id" };
  const options = { currentDepth: 0, syncChain: [] };

  it("$pulls the deleted element by id instead of $unset-ing the array", () => {
    const instruction = manager().buildDeleteInstruction(7, {
      ...base,
      targetField: "tags",
      isMany: true,
    }, options);

    expect(instruction.update).toEqual({ $pull: { tags: { id: 7 } } });
  });

  it("still $unsets a single embedded object", () => {
    const instruction = manager().buildDeleteInstruction(7, {
      ...base,
      targetField: "category",
      isMany: false,
    }, options);

    expect(instruction.update).toEqual({ $unset: { category: 1 } });
  });
});
