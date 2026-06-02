import { beforeEach, describe, expect, it } from "vitest";
import { SqlDatabaseDirtyTracker } from "../../src/sql-database-dirty-tracker";

describe("SqlDatabaseDirtyTracker", () => {
  let tracker: SqlDatabaseDirtyTracker;

  beforeEach(() => {
    tracker = new SqlDatabaseDirtyTracker({
      id: 1,
      user: {
        name: "John Doe",
        email: "john@example.com",
      },
      tags: ["admin"],
    });
  });

  describe("mergeChanges without flattening", () => {
    it("should report the top-level property as dirty when nested property changes", () => {
      tracker.mergeChanges({
        user: { name: "Jane Doe" },
      });

      expect(tracker.hasChanges()).toBe(true);
      // It should only report 'user' instead of 'user.name'
      expect(tracker.getDirtyColumns()).toEqual(["user"]);
    });

    it("should report the entire object as changed in getDirtyColumnsWithValues", () => {
      tracker.mergeChanges({
        user: { name: "Jane Doe" },
      });

      const dirtyData = tracker.getDirtyColumnsWithValues();
      expect(dirtyData).toHaveProperty("user");
      // The old value is the full object
      expect(dirtyData.user?.oldValue).toEqual({
        name: "John Doe",
        email: "john@example.com",
      });
      // The new value is the updated full object
      expect(dirtyData.user?.newValue).toEqual({
        name: "Jane Doe",
        email: "john@example.com",
      });
    });

    it("should handle replacing arrays at top level", () => {
      tracker.mergeChanges({
        tags: ["admin", "superadmin"],
      });

      expect(tracker.hasChanges()).toBe(true);
      expect(tracker.getDirtyColumns()).toEqual(["tags"]);
    });

    it("should not report changes if the nested object is identical after merge", () => {
      tracker.mergeChanges({
        user: { name: "John Doe" }, // same value
      });

      expect(tracker.hasChanges()).toBe(false);
      expect(tracker.getDirtyColumns()).toEqual([]);
    });

    it("should unset entire top-level object without unsetting just the nested property", () => {
      tracker.unset("user");

      expect(tracker.hasChanges()).toBe(true);
      expect(tracker.getRemovedColumns()).toEqual(["user"]);
      
      const dirtyData = tracker.getDirtyColumnsWithValues();
      expect(dirtyData).toHaveProperty("user");
      expect(dirtyData.user?.newValue).toBeUndefined();
    });
  });
});
