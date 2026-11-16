import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";

const saved = vi.hoisted(() => ({ snapshots: [] as Record<string, unknown>[] }));

vi.mock("../writer/database-writer", () => ({
  DatabaseWriter: class {
    public constructor(private readonly model: { data: Record<string, unknown> }) {}

    public async save() {
      saved.snapshots.push({ ...this.model.data });
    }
  },
}));

import { Model } from "./model";
import { applyScopeStamp, collectScopeStamp } from "./methods/scope-methods";

let tenant = 7;

class Order extends Model<{ name?: string; tenantId?: number | null }> {
  public static table = "orders";
}

Order.addGlobalScope("tenant", () => undefined, { stamp: () => ({ tenantId: tenant }) });

class Plain extends Model<{ name?: string }> {
  public static table = "plain";
}

describe("global scope stamp", () => {
  beforeEach(() => {
    saved.snapshots.length = 0;
    tenant = 7;
    dataSourceRegistry.clear();

    const driver = {
      dialect: new PostgresDialect(),
      on: () => undefined,
      getDirtyTracker: () => ({ mergeChanges: () => undefined, setAtPath: () => undefined }),
    };
    dataSourceRegistry.register(
      new DataSource({ name: "stamp", driver: driver as never, isDefault: true }),
    );
  });

  it("evaluates a function stamp at each call", () => {
    expect(collectScopeStamp(Order)).toEqual({ tenantId: 7 });

    tenant = 8;

    expect(collectScopeStamp(Order)).toEqual({ tenantId: 8 });
  });

  it("does not leak a stamp to a model without the scope", () => {
    expect(collectScopeStamp(Plain)).toEqual({});
  });

  it("stamps an unset column and keeps a value the caller set", () => {
    const missing = new Order({ name: "a" });
    const explicit = new Order({ name: "b", tenantId: 3 });

    expect(applyScopeStamp(missing)).toEqual(["tenantId"]);
    expect(applyScopeStamp(explicit)).toEqual([]);
    expect(missing.get("tenantId")).toBe(7);
    expect(explicit.get("tenantId")).toBe(3);
  });

  it("create() writes the stamped column into the insert", async () => {
    await Order.create({ name: "a" });

    expect(saved.snapshots).toEqual([{ name: "a", tenantId: 7 }]);
  });

  it("skips undefined stamp values", () => {
    class Loose extends Model<{ tenantId?: number }> {
      public static table = "loose";
    }
    Loose.addGlobalScope("t", () => undefined, { stamp: { tenantId: undefined } });

    expect(collectScopeStamp(Loose)).toEqual({});
  });
});
