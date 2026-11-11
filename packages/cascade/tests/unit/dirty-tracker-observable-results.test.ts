import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseDirtyTracker } from "../../src/database-dirty-tracker";
import { dataSourceRegistry } from "../../src/data-source/data-source-registry";
import { Model } from "../../src/model/model";
import { SqlDatabaseDirtyTracker } from "../../src/sql-database-dirty-tracker";
import { createMockDriver } from "../utils/test-helpers";

/**
 * Pins every result the dirty tracker exposes (dirty columns and their order,
 * removed columns, removed paths, replaced columns, old/new values) across the
 * mutation APIs, so the tracker's internals can change without any caller
 * seeing a difference.
 */

class ObjectIdLike {
  public constructor(public readonly hex: string) {}
}

function results(tracker: DatabaseDirtyTracker) {
  return {
    hasChanges: tracker.hasChanges(),
    dirty: tracker.getDirtyColumns(),
    removed: tracker.getRemovedColumns(),
    removedPaths: tracker.getRemovedPaths(),
    replaced: tracker.getReplacedColumns(),
    values: tracker.getDirtyColumnsWithValues(),
  };
}

const clean = {
  hasChanges: false,
  dirty: [],
  removed: [],
  removedPaths: [],
  replaced: [],
  values: {},
};

function document() {
  return {
    id: 1,
    name: "Ada",
    profile: { bio: "x", links: { site: "a.dev" } },
    tags: ["a", "b"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ownerId: new ObjectIdLike("abc"),
    empty: {},
  };
}

describe("DatabaseDirtyTracker — observable results", () => {
  it("is clean right after construction", () => {
    expect(results(new DatabaseDirtyTracker(document()))).toEqual(clean);
  });

  it("does not see changes the caller makes to the object it passed in", () => {
    const data = document();
    const tracker = new DatabaseDirtyTracker(data);

    data.name = "Grace";
    data.profile.bio = "changed";
    data.tags.push("c");

    expect(results(tracker)).toEqual(clean);

    tracker.setAtPath("age", 30);

    expect(tracker.getDirtyColumns()).toEqual(["age"]);
  });

  it("does not see changes the caller makes to a value after set", () => {
    const tracker = new DatabaseDirtyTracker(document());
    const links = { site: "b.dev" };

    tracker.setAtPath("profile.links", links);
    links.site = "c.dev";

    expect(tracker.getDirtyColumnsWithValues()).toEqual({
      "profile.links.site": { oldValue: "a.dev", newValue: "b.dev" },
    });
  });

  it("does not see changes the caller makes to a merged value", () => {
    const tracker = new DatabaseDirtyTracker(document());
    const tags = ["z"];

    tracker.mergeChanges({ tags });
    tags.push("y");

    expect(tracker.getDirtyColumnsWithValues()).toEqual({
      tags: { oldValue: ["a", "b"], newValue: ["z"] },
    });
  });

  it("reports set() changes in baseline key order, then new keys", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("tags", ["c"]);
    tracker.setAtPath("extra", true);
    tracker.setAtPath("name", "Grace");
    tracker.setAtPath("profile.links.site", "b.dev");

    expect(results(tracker)).toEqual({
      hasChanges: true,
      dirty: ["name", "profile.links.site", "tags", "extra"],
      removed: [],
      removedPaths: [],
      replaced: [],
      values: {
        name: { oldValue: "Ada", newValue: "Grace" },
        "profile.links.site": { oldValue: "a.dev", newValue: "b.dev" },
        tags: { oldValue: ["a", "b"], newValue: ["c"] },
        extra: { oldValue: undefined, newValue: true },
      },
    });
  });

  it("reports a whole nested object replaced by set()", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("profile", { bio: "y" });

    expect(results(tracker)).toEqual({
      hasChanges: true,
      dirty: ["profile.bio", "profile.links.site"],
      removed: ["profile.links.site"],
      removedPaths: ["profile.links"],
      replaced: ["profile"],
      values: {
        "profile.bio": { oldValue: "x", newValue: "y" },
        "profile.links.site": { oldValue: "a.dev", newValue: undefined },
      },
    });
  });

  it("deep-merges plain objects and replaces arrays, dates and class instances", () => {
    const tracker = new DatabaseDirtyTracker(document());
    const later = new Date("2026-02-01T00:00:00.000Z");
    const owner = new ObjectIdLike("def");

    tracker.mergeChanges({
      profile: { links: { repo: "gh" } },
      tags: ["a"],
      createdAt: later,
      ownerId: owner,
    });

    const values = tracker.getDirtyColumnsWithValues();

    expect(tracker.getDirtyColumns()).toEqual([
      "tags",
      "createdAt",
      "ownerId",
      "profile.links.repo",
    ]);
    expect(tracker.getReplacedColumns()).toEqual([]);
    expect(values["profile.links.repo"]).toEqual({ oldValue: undefined, newValue: "gh" });
    expect((values.createdAt!.newValue as Date).getTime()).toBe(later.getTime());
    // Class instances are kept by reference.
    expect(values.ownerId?.newValue).toBe(owner);
  });

  it("reports nothing when equal values are written back", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("tags", ["a", "b"]);
    tracker.setAtPath("createdAt", new Date("2026-01-01T00:00:00.000Z"));
    tracker.mergeChanges({ profile: { bio: "x" } });

    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.getDirtyColumns()).toEqual([]);
  });

  it("goes back to clean when a change is reverted", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("name", "Grace");
    expect(tracker.isDirty("name")).toBe(true);

    tracker.setAtPath("name", "Ada");
    expect(tracker.isDirty("name")).toBe(false);
    expect(tracker.getDirtyColumns()).toEqual([]);
  });

  it("reports unset leaves, emptied parents and array items", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.unset(["profile.links.site", "tags.0", "name"]);

    expect(results(tracker)).toEqual({
      hasChanges: true,
      dirty: ["name", "profile.links.site", "tags"],
      removed: ["name", "profile.links.site"],
      removedPaths: ["name", "profile.links"],
      replaced: [],
      values: {
        name: { oldValue: "Ada", newValue: undefined },
        "profile.links.site": { oldValue: "a.dev", newValue: undefined },
        tags: { oldValue: ["a", "b"], newValue: ["b"] },
      },
    });
  });

  it("reports an unset stored {} as a replaced column", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.unset("empty");

    expect(results(tracker)).toEqual({
      ...clean,
      hasChanges: true,
      replaced: ["empty"],
    });
  });

  it("compares replaceCurrentData() against the baseline", () => {
    const tracker = new DatabaseDirtyTracker(document());
    const replacement = { ...document(), name: "Grace", tags: ["a", "b"] } as Record<
      string,
      unknown
    >;

    delete replacement.empty;
    tracker.replaceCurrentData(replacement);
    (replacement.tags as string[]).push("late");

    expect(tracker.getDirtyColumns()).toEqual(["name"]);
    expect(tracker.getDirtyColumnsWithValues()).toEqual({
      name: { oldValue: "Ada", newValue: "Grace" },
    });
  });

  it("makes the current data the baseline on reset()", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("name", "Grace");
    tracker.setAtPath("profile.bio", "y");
    const before = tracker.getDirtyColumnsWithValues();

    tracker.reset();

    expect(results(tracker)).toEqual(clean);

    // Mutating a value handed out before the reset never reaches the baseline.
    (before["name"] as { newValue: unknown }).newValue = "Mutated";

    tracker.setAtPath("profile.bio", "z");

    expect(tracker.getDirtyColumnsWithValues()).toEqual({
      "profile.bio": { oldValue: "y", newValue: "z" },
    });
  });

  it("keeps an array handed out by getDirtyColumnsWithValues() out of the new baseline", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("tags", ["c"]);
    const handedOut = tracker.getDirtyColumnsWithValues().tags?.newValue as string[];

    tracker.reset();
    handedOut.push("mutated");

    tracker.setAtPath("name", "Grace");

    expect(tracker.getDirtyColumns()).toEqual(["name"]);

    tracker.setAtPath("tags", ["c"]);

    expect(tracker.getDirtyColumns()).toEqual(["name"]);
  });

  it("uses the given data as the new baseline on reset(data)", () => {
    const tracker = new DatabaseDirtyTracker(document());
    const data = { id: 1, name: "Linus", tags: ["x"] };

    tracker.setAtPath("name", "Grace");
    tracker.reset(data);
    data.tags.push("late");

    expect(results(tracker)).toEqual(clean);

    tracker.setAtPath("tags", ["x"]);

    expect(tracker.getDirtyColumns()).toEqual([]);
  });

  it("tracks changes again after a reset", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("name", "Grace");
    tracker.reset();
    tracker.unset("profile.bio");
    tracker.mergeChanges({ tags: ["q"] });

    expect(results(tracker)).toEqual({
      hasChanges: true,
      dirty: ["profile.bio", "tags"],
      removed: ["profile.bio"],
      removedPaths: ["profile.bio"],
      replaced: [],
      values: {
        "profile.bio": { oldValue: "x", newValue: undefined },
        tags: { oldValue: ["a", "b"], newValue: ["q"] },
      },
    });
  });

  it("reads the same results however often they are read between writes", () => {
    const tracker = new DatabaseDirtyTracker(document());

    tracker.setAtPath("name", "Grace");
    const first = results(tracker);
    const second = results(tracker);

    tracker.setAtPath("profile.bio", "y");

    expect(first).toEqual(second);
    expect(tracker.getDirtyColumns()).toEqual(["name", "profile.bio"]);
  });
});

describe("SqlDatabaseDirtyTracker — observable results", () => {
  it("reports top-level columns with whole old and new values", () => {
    const tracker = new SqlDatabaseDirtyTracker(document());

    tracker.setAtPath("profile.links.site", "b.dev");
    tracker.mergeChanges({ tags: ["c"] });

    expect(results(tracker)).toEqual({
      hasChanges: true,
      dirty: ["profile", "tags"],
      removed: [],
      removedPaths: [],
      replaced: [],
      values: {
        profile: {
          oldValue: { bio: "x", links: { site: "a.dev" } },
          newValue: { bio: "x", links: { site: "b.dev" } },
        },
        tags: { oldValue: ["a", "b"], newValue: ["c"] },
      },
    });
  });

  it("reports a stored {} column unset as removed", () => {
    const tracker = new SqlDatabaseDirtyTracker(document());

    tracker.unset("empty");

    expect(results(tracker)).toEqual({
      hasChanges: true,
      dirty: ["empty"],
      removed: ["empty"],
      removedPaths: ["empty"],
      replaced: ["empty"],
      values: { empty: { oldValue: {}, newValue: undefined } },
    });
  });

  it("is clean after reset and sees later nested changes", () => {
    const tracker = new SqlDatabaseDirtyTracker(document());

    tracker.setAtPath("name", "Grace");
    tracker.reset();

    expect(results(tracker)).toEqual(clean);

    tracker.mergeChanges({ profile: { bio: "y" } });

    expect(tracker.getDirtyColumns()).toEqual(["profile"]);
  });
});

describe("Model dirty results", () => {
  beforeAll(() => {
    dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
  });

  afterAll(() => {
    dataSourceRegistry.clear();
  });

  class Account extends Model {
    public static table = "accounts";
  }

  function loaded() {
    const account = new Account(document());
    account.isNew = false;
    return account;
  }

  it("is clean when the caller mutates the object it constructed the model with", () => {
    const data = document();
    const account = new Account(data);

    data.name = "Grace";

    // The model holds the caller's object, the tracker its own copy.
    expect(account.get("name")).toBe("Grace");
    expect(account.hasChanges()).toBe(false);
  });

  it("does not track mutations made through an object a getter returned", () => {
    const account = loaded();
    const profile = account.get("profile") as { bio: string };

    profile.bio = "mutated in place";

    expect(account.get("profile.bio")).toBe("mutated in place");
    expect(account.hasChanges()).toBe(false);
    expect(account.getDirtyColumns()).toEqual([]);
  });

  it("tracks set, merge and unset in one consistent diff", () => {
    const account = loaded();

    account.set("name", "Grace");
    account.merge({ profile: { links: { repo: "gh" } } });
    account.unset("tags");

    expect(account.getDirtyColumns()).toEqual(["name", "tags", "profile.links.repo"]);
    expect(account.getRemovedColumns()).toEqual(["tags"]);
    expect(account.getDirtyColumnsWithValues()).toEqual({
      name: { oldValue: "Ada", newValue: "Grace" },
      tags: { oldValue: ["a", "b"], newValue: undefined },
      "profile.links.repo": { oldValue: undefined, newValue: "gh" },
    });
  });

  it("copies the data only once while hydrating a model", () => {
    const cloneData = vi.spyOn(DatabaseDirtyTracker.prototype as any, "cloneData");

    try {
      const account = Account.hydrate(document());

      expect(cloneData).toHaveBeenCalledTimes(1);
      expect(account.hasChanges()).toBe(false);
    } finally {
      cloneData.mockRestore();
    }
  });

  it("flattens the document once for many set() calls", () => {
    const account = loaded();
    const flattenData = vi.spyOn(account.dirtyTracker as any, "flattenData");

    for (let index = 0; index < 50; index += 1) {
      account.set(`field${index}`, index);
    }

    expect(flattenData).not.toHaveBeenCalled();
    expect(account.getDirtyColumns()).toHaveLength(50);
    expect(flattenData).toHaveBeenCalledTimes(1);
  });
});
