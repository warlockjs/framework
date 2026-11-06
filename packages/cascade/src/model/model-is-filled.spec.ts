import { beforeEach, describe, expect, it } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { Model } from "./model";

class Profile extends Model<{ avatar?: string | null; bio?: string; visits?: number; nested?: unknown }> {
  public static table = "profiles";
}

describe("Model.isFilled", () => {
  beforeEach(() => {
    dataSourceRegistry.clear();

    const driver = { dialect: new PostgresDialect(), on: () => undefined,
      getDirtyTracker: () => ({}),
    };
    dataSourceRegistry.register(
      new DataSource({ name: "is-filled", driver: driver as never, isDefault: true }),
    );
  });

  it("is false for a null column, a missing column and an undefined value", () => {
    const profile = new Profile({ avatar: null, bio: undefined });

    expect(profile.isFilled("avatar")).toBe(false);
    expect(profile.isFilled("bio")).toBe(false);
    expect(profile.isFilled("visits")).toBe(false);
  });

  it("is true for any other value, including empty string, zero and false", () => {
    const profile = new Profile({ avatar: "", visits: 0, nested: { done: false } });

    expect(profile.isFilled("avatar")).toBe(true);
    expect(profile.isFilled("visits")).toBe(true);
    expect(profile.isFilled("nested.done")).toBe(true);
  });

  it("keeps has() true for a null column while isFilled() is false", () => {
    const profile = new Profile({ avatar: null });

    expect(profile.has("avatar")).toBe(true);
    expect(profile.isFilled("avatar")).toBe(false);
  });
});
