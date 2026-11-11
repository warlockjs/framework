import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseDirtyTracker } from "../../../src/database-dirty-tracker";
import { Model } from "../../../src/model/model";
import type { StrictMode } from "../../../src/types";
import { DatabaseWriterValidationError } from "../../../src/validation";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

/**
 * Nested changes on an update are reported as leaf paths (`profile.role`).
 * They must go through the schema and `strictMode` like top-level columns:
 * undeclared nested data is stripped (or rejected), declared data is cast.
 */

const schema = v.object({
  name: v.string(),
  profile: v
    .object({
      bio: v.string().optional(),
      avatar: v.string().optional(),
      birthday: v.date().optional(),
    })
    .optional(),
});

function modelClass(strictMode: StrictMode) {
  return class Member extends Model {
    public static table = "members";
    public static autoGenerateId = false;
    public static schema = schema;
    public static strictMode = strictMode;
  };
}

describe("update validation of nested data", () => {
  // The default MongoDB tracker reports nested changes as leaf paths.
  const driver = createMockDriver();
  (driver as any).getDirtyTracker = (data: Record<string, unknown>) =>
    new DatabaseDirtyTracker(data);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function persisted(strictMode: StrictMode) {
    const Member = modelClass(strictMode);
    vi.spyOn(Member, "getDataSource").mockReturnValue(createMockDataSource({ driver }));

    const member = new Member({
      id: 1,
      name: "Ada",
      profile: { bio: "x", avatar: "a.png" },
    });
    member.isNew = false;

    return member;
  }

  async function save(model: Model): Promise<Record<string, any>> {
    await new DatabaseWriter(model).save();

    return (driver.update as any).mock.calls.at(-1)?.[2] ?? {};
  }

  it("strips an undeclared nested object and keeps the declared leaf (strip)", async () => {
    const member = persisted("strip");

    member.merge({ profile: { bio: "y" }, permissions: { all: true } });

    const operations = await save(member);

    expect(operations.$set["profile.bio"]).toBe("y");
    expect(operations.$set).not.toHaveProperty("permissions.all");
    expect(operations.$set).not.toHaveProperty("permissions");
    expect(operations.$set).not.toHaveProperty("profile.avatar");
    expect(operations.$unset).toBeUndefined();
  });

  it("strips an undeclared object assigned whole with set() (strip)", async () => {
    const member = persisted("strip");

    member.set({ permissions: { all: true } });

    const operations = await save(member);

    expect(operations.$set ?? {}).not.toHaveProperty("permissions");
    expect(operations.$set ?? {}).not.toHaveProperty("permissions.all");
  });

  it("rejects an undeclared nested object (fail)", async () => {
    const member = persisted("fail");

    member.merge({ permissions: { all: true } });

    await expect(save(member)).rejects.toBeInstanceOf(DatabaseWriterValidationError);
    expect(driver.update).not.toHaveBeenCalled();
  });

  it("writes an undeclared nested object when strictMode allows it", async () => {
    const member = persisted("allow");

    member.merge({ permissions: { all: true } });

    const operations = await save(member);

    expect(operations.$set["permissions.all"]).toBe(true);
  });

  it("rejects an undeclared key inside a declared nested object", async () => {
    const member = persisted("strip");

    member.merge({ profile: { role: "admin" } });

    await expect(save(member)).rejects.toBeInstanceOf(DatabaseWriterValidationError);
    expect(driver.update).not.toHaveBeenCalled();
  });

  it("casts a nested leaf through its schema", async () => {
    const member = persisted("strip");

    member.merge({ profile: { birthday: "2000-01-02T00:00:00.000Z" } });

    const operations = await save(member);

    expect(operations.$set["profile.birthday"]).toBeInstanceOf(Date);
    expect(member.get("profile.birthday")).toBeInstanceOf(Date);
  });

  it("rejects a nested leaf of the wrong type", async () => {
    const member = persisted("strip");

    member.merge({ profile: { bio: 5 } });

    await expect(save(member)).rejects.toBeInstanceOf(DatabaseWriterValidationError);
  });

  it("keeps a nested update partial: siblings are not rewritten", async () => {
    const member = persisted("strip");

    member.set("profile.bio", "z");

    const operations = await save(member);

    expect(operations.$set["profile.bio"]).toBe("z");
    expect(operations.$set).not.toHaveProperty("profile");
    expect(operations.$set).not.toHaveProperty("profile.avatar");
  });

  it("writes neither the value nor the removals of an undeclared object replaced whole (strip)", async () => {
    const Member = modelClass("strip");
    vi.spyOn(Member, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
    const member = new Member({ id: 1, name: "Ada", settings: { a: 1, b: 2 } });
    member.isNew = false;

    member.set("settings", { a: 1 });
    member.set("name", "Grace");

    const operations = await save(member);

    expect(operations.$set).toMatchObject({ name: "Grace" });
    expect(operations.$set).not.toHaveProperty("settings");
    expect(operations.$unset).toBeUndefined();
  });

  it("still writes an explicit unset below an undeclared field, like a top-level unset", async () => {
    const Member = modelClass("strip");
    vi.spyOn(Member, "getDataSource").mockReturnValue(createMockDataSource({ driver }));
    const member = new Member({ id: 1, name: "Ada", settings: { a: 1, b: 2 } });
    member.isNew = false;

    member.unset("settings.b");

    const operations = await save(member);

    expect(operations.$unset).toEqual({ "settings.b": 1 });
  });

  it("strips an unknown top-level column on update instead of failing (strip)", async () => {
    const member = persisted("strip");

    member.merge({ name: "Grace", isAdmin: true });

    const operations = await save(member);

    expect(operations.$set).toMatchObject({ name: "Grace" });
    expect(operations.$set).not.toHaveProperty("isAdmin");
  });

  it("lets an explicit unset win over a schema default, nested as at the top level", async () => {
    class Themed extends Model {
      public static table = "themed";
      public static autoGenerateId = false;
      public static strictMode: StrictMode = "strip";
      public static schema = v.object({
        name: v.string(),
        status: v.string().default("draft"),
        settings: v.object({ theme: v.string().default("light"), size: v.number() }).optional(),
      });
    }
    vi.spyOn(Themed, "getDataSource").mockReturnValue(createMockDataSource({ driver }));

    const model = new Themed({
      id: 1,
      name: "Ada",
      status: "live",
      settings: { theme: "dark", size: 2 },
    });
    model.isNew = false;

    model.unset("settings.theme", "status");
    model.set("settings.size", 3);

    const operations = await save(model);

    expect(operations.$unset).toEqual({ "settings.theme": 1, status: 1 });
    expect(operations.$set).toEqual({ "settings.size": 3 });
    expect(model.get("settings")).toEqual({ size: 3 });
  });

  it("still writes the removal of an optional nested leaf", async () => {
    const member = persisted("strip");

    member.unset("profile.avatar");

    const operations = await save(member);

    expect(operations.$unset).toEqual({ "profile.avatar": 1 });
  });
});
