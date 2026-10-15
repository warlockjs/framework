import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverContract } from "../../../src/contracts/database-driver.contract";
import type { DataSource } from "../../../src/data-source/data-source";
import { Model } from "../../../src/model/model";
import { saveModel } from "../../../src/model/methods/write-methods";
import { DatabaseRemover } from "../../../src/remover/database-remover";
import { DatabaseWriter } from "../../../src/writer/database-writer";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

/**
 * Security regression tests for primary-key retargeting.
 *
 * `model.merge(req.body); await model.save()` is the canonical "update my
 * profile" shape. The UPDATE filter used to be built from the POST-merge
 * primary key, so a body carrying `{ id: "<victim-id>" }` redirected the write
 * to somebody else's document — and the mass-assigned fields went with it.
 *
 * Two independent controls are asserted here:
 * (a) `merge()` on an already-persisted model drops identity columns
 *     (`id` / `_id` / the configured primary key);
 * (b) the write filter is built from the primary key captured when the model
 *     became persisted, so even an explicit `set()` cannot move the target.
 *
 * Creating a NEW record with an explicit id stays a legitimate flow.
 */

class RetargetUser extends Model {
  static table = "users";
  static primaryKey = "id";
}

class MongoRetargetUser extends Model {
  static table = "users";
  static primaryKey = "_id";
}

describe("primary key retargeting", () => {
  let driver: DriverContract;
  let dataSource: DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = createMockDriver();
    dataSource = createMockDataSource({ driver });

    vi.spyOn(RetargetUser, "getDataSource").mockReturnValue(dataSource);
    vi.spyOn(MongoRetargetUser, "getDataSource").mockReturnValue(dataSource);
  });

  /** A model in the state `Model.find(1)` leaves it in. */
  function loadedUser(data: Record<string, unknown> = { id: 1, name: "Alice", role: "member" }) {
    const user = new RetargetUser(data);
    user.isNew = false;
    return user;
  }

  describe("merge() on a persisted model", () => {
    it("cannot retarget the update at another document", async () => {
      const user = loadedUser();

      user.merge({ id: 999, role: "admin" });

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      const [table, filter] = (driver.update as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(table).toBe("users");
      expect(filter).toEqual({ id: 1 });
    });

    it("does not let the merged id reach the model data", () => {
      const user = loadedUser();

      user.merge({ id: 999, role: "admin" });

      expect(user.get("id")).toBe(1);
      expect(user.get("role")).toBe("admin");
    });

    it("does not write the primary key into $set", async () => {
      const user = loadedUser();

      user.merge({ id: 999, role: "admin" });

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      const [, , operations] = (driver.update as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(operations.$set).not.toHaveProperty("id");
      expect(operations.$set.role).toBe("admin");
    });

    it("drops _id as well, whatever the configured primary key is", () => {
      const user = loadedUser({ id: 1, _id: "aaa", name: "Alice" });

      user.merge({ _id: "victim", name: "Mallory" });

      expect(user.get("_id")).toBe("aaa");
      expect(user.get("name")).toBe("Mallory");
    });

    it("pins the filter to _id for an _id-keyed model", async () => {
      const user = new MongoRetargetUser({ _id: "own", name: "Alice" });
      user.isNew = false;

      user.merge({ _id: "victim", name: "Mallory" });

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      const [, filter] = (driver.update as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(filter).toEqual({ _id: "own" });
    });

    it("does not mutate the caller's payload object", () => {
      const user = loadedUser();
      const body = { id: 999, role: "admin" };

      user.merge(body);

      expect(body).toEqual({ id: 999, role: "admin" });
    });

    it("leaves non-identity payloads untouched", () => {
      const user = loadedUser();

      user.merge({ name: "Alice Smith", profile: { city: "NY" } });

      expect(user.get("name")).toBe("Alice Smith");
      expect(user.get("profile.city")).toBe("NY");
    });

    it("blocks retargeting through save({ merge })", async () => {
      const user = loadedUser();

      await saveModel(user, {
        merge: { id: 999, role: "admin" },
        skipEvents: true,
        skipSync: true,
      });

      const [, filter] = (driver.update as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(filter).toEqual({ id: 1 });
      expect(user.get("id")).toBe(1);
    });
  });

  describe("explicit set() on a persisted model", () => {
    it("still writes to the originally loaded row", async () => {
      const user = loadedUser();

      user.set("id", 999);
      user.set("role", "admin");

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      const [, filter, operations] = (driver.update as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(filter).toEqual({ id: 1 });
      expect(operations.$set).not.toHaveProperty("id");
    });

    it("keeps the primary key out of $unset", async () => {
      const user = loadedUser();

      user.unset("id");
      user.set("role", "admin");

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      const [, filter, operations] = (driver.update as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(filter).toEqual({ id: 1 });
      expect(operations.$unset).toBeUndefined();
    });
  });

  describe("replace and delete filters", () => {
    it("replace() targets the loaded row, not the merged one", async () => {
      const user = loadedUser();

      user.merge({ id: 999, name: "Mallory" });

      await new DatabaseWriter(user).save({
        replace: true,
        skipEvents: true,
        skipSync: true,
      });

      const [, filter] = (driver.replace as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(filter).toEqual({ id: 1 });
    });

    it("destroy() deletes the loaded row, not the merged one", async () => {
      const user = loadedUser();

      user.merge({ id: 999 });

      await new DatabaseRemover(user).destroy({ strategy: "permanent", skipEvents: true });

      const [, filter] = (driver.delete as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(filter).toEqual({ id: 1 });
    });
  });

  describe("legitimate flows", () => {
    it("a NEW model may still be created with an explicit id", async () => {
      const user = new RetargetUser({ name: "Alice" });

      user.merge({ id: 42, role: "member" });

      expect(user.get("id")).toBe(42);

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      const [table, document] = (driver.insert as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(table).toBe("users");
      expect(document.id).toBe(42);
      expect(driver.update).not.toHaveBeenCalled();
    });

    it("captures the primary key generated by the insert", async () => {
      const user = new RetargetUser({ name: "Alice" });

      await new DatabaseWriter(user).save({ skipEvents: true, skipSync: true });

      // The mock driver's insert returns { id: 1, _id: "mock_id_123" }
      expect(user.isNew).toBe(false);
      expect(user.trustedPrimaryKey).toBe(1);
    });

    it("exposes the loaded key through trustedPrimaryKey", () => {
      const user = loadedUser();

      expect(user.trustedPrimaryKey).toBe(1);

      user.merge({ id: 999 });

      expect(user.trustedPrimaryKey).toBe(1);
    });

    it("falls back to the current key while the model is still new", () => {
      const user = new RetargetUser({ id: 7, name: "Alice" });

      expect(user.trustedPrimaryKey).toBe(7);
    });

    it("re-captures when a model is marked persisted again", () => {
      const user = loadedUser();

      user.isNew = true;
      user.merge({ id: 999 });
      user.isNew = false;

      expect(user.trustedPrimaryKey).toBe(999);
    });
  });
});
