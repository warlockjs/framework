/**
 * Unit tests for PivotOperations — attach/detach/sync/toggle against a
 * many-to-many pivot table.
 *
 * The mock driver stubs insertMany / deleteMany / queryBuilder. We override
 * queryBuilder with a recording fake so each test controls the "existing
 * pivot rows" the operation reads back before deciding what to write.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import {
  cleanupModelsRegistery,
  registerModelInRegistry,
} from "../../../src/model/register-model";
import {
  createPivotOperations,
  PivotOperations,
} from "../../../src/relations/pivot-operations";
import type { RelationDefinition } from "../../../src/relations/types";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * Recording fake for the pivot-read query: queryBuilder(table).select([...])
 * .where(col, val).get(). Returns `existing` rows from get().
 */
function fakePivotReadQuery(existing: Record<string, unknown>[]) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.get = vi.fn(async () => existing);
  return query;
}

class Tag extends Model {
  static table = "tags";
}

class Post extends Model {
  static table = "posts";
  static relations: Record<string, RelationDefinition> = {
    tags: { type: "belongsToMany", model: "Tag" },
    author: { type: "belongsTo", model: "Tag" }, // wrong-type, for the guard test
  };
}

const tagsDefinition: RelationDefinition = { type: "belongsToMany", model: "Tag" };

describe("relations/pivot-operations", () => {
  beforeAll(() => {
    dataSourceRegistry.register({
      name: "test",
      driver: createMockDriver(),
      isDefault: true,
    });
    registerModelInRegistry("Tag", Tag);
    registerModelInRegistry("Post", Post);
  });

  afterAll(() => {
    dataSourceRegistry.clear();
    cleanupModelsRegistery();
  });

  let driver: ReturnType<typeof createMockDriver>;

  beforeEach(() => {
    vi.restoreAllMocks();
    driver = Post.getDataSource().driver;
    (driver.insertMany as ReturnType<typeof vi.fn>).mockClear();
    (driver.deleteMany as ReturnType<typeof vi.fn>).mockClear();
  });

  // ==========================================================================
  // constructor / factory guards
  // ==========================================================================

  describe("guards", () => {
    it("throws when constructed for a non-belongsToMany relation", () => {
      const post = new Post({ id: 1 });
      expect(
        () =>
          new PivotOperations(
            post,
            "author",
            { type: "belongsTo", model: "Tag" },
            Post as never,
          ),
      ).toThrow(/only available for belongsToMany/);
    });

    it("createPivotOperations throws for an undefined relation", () => {
      const post = new Post({ id: 1 });
      expect(() => createPivotOperations(post, "missing")).toThrow(
        /Relation "missing" is not defined on model "Post"/,
      );
    });

    it("createPivotOperations returns a PivotOperations for a valid relation", () => {
      const post = new Post({ id: 1 });
      expect(createPivotOperations(post, "tags")).toBeInstanceOf(PivotOperations);
    });
  });

  // ==========================================================================
  // attach
  // ==========================================================================

  describe("attach", () => {
    it("inserts pivot rows for ids that are not already attached", async () => {
      const post = new Post({ id: 1 });
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        fakePivotReadQuery([{ tag_id: 2 }]), // 2 already attached
      );

      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.attach([2, 3, 4], { addedBy: 99 });

      expect(driver.insertMany).toHaveBeenCalledTimes(1);
      const [table, rows] = (driver.insertMany as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(table).toBe("post_tag");
      expect(rows).toEqual([
        { post_id: 1, tag_id: 3, addedBy: 99 },
        { post_id: 1, tag_id: 4, addedBy: 99 },
      ]);
    });

    it("returns early without inserting when given an empty id list", async () => {
      const post = new Post({ id: 1 });
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.attach([]);
      expect(driver.insertMany).not.toHaveBeenCalled();
    });

    it("does not insert when every id is already attached", async () => {
      const post = new Post({ id: 1 });
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        fakePivotReadQuery([{ tag_id: 2 }, { tag_id: 3 }]),
      );
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.attach([2, 3]);
      expect(driver.insertMany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // detach
  // ==========================================================================

  describe("detach", () => {
    it("deletes only the specified ids using an $in filter", async () => {
      const post = new Post({ id: 1 });
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.detach([2, 3]);

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag", {
        post_id: 1,
        tag_id: { $in: [2, 3] },
      });
    });

    it("deletes all rows for this side when no ids are given", async () => {
      const post = new Post({ id: 1 });
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.detach();

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag", { post_id: 1 });
    });

    it("treats an empty id array as detach-all (no $in filter)", async () => {
      const post = new Post({ id: 1 });
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.detach([]);

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag", { post_id: 1 });
    });
  });

  // ==========================================================================
  // sync
  // ==========================================================================

  describe("sync", () => {
    it("detaches removed ids and attaches new ones to match the target set", async () => {
      const post = new Post({ id: 1 });
      // Existing: [2, 3]; target: [3, 4] → detach 2, attach 4.
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        fakePivotReadQuery([{ tag_id: 2 }, { tag_id: 3 }]),
      );

      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.sync([3, 4]);

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag", {
        post_id: 1,
        tag_id: { $in: [2] },
      });
      const insertRows = (driver.insertMany as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(insertRows).toEqual([{ post_id: 1, tag_id: 4 }]);
    });

    it("only attaches when the target adds ids without removing any", async () => {
      const post = new Post({ id: 1 });
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        fakePivotReadQuery([{ tag_id: 2 }]),
      );
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.sync([2, 5]);

      expect(driver.deleteMany).not.toHaveBeenCalled();
      const insertRows = (driver.insertMany as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(insertRows).toEqual([{ post_id: 1, tag_id: 5 }]);
    });

    it("only detaches when the target removes ids without adding any", async () => {
      const post = new Post({ id: 1 });
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        fakePivotReadQuery([{ tag_id: 2 }, { tag_id: 3 }]),
      );
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.sync([2]);

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag", {
        post_id: 1,
        tag_id: { $in: [3] },
      });
      expect(driver.insertMany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // toggle
  // ==========================================================================

  describe("toggle", () => {
    it("attaches missing ids and detaches present ones in a single pass", async () => {
      const post = new Post({ id: 1 });
      // Existing: [2]; toggle [2, 5] → detach 2, attach 5.
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        fakePivotReadQuery([{ tag_id: 2 }]),
      );
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.toggle([2, 5]);

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag", {
        post_id: 1,
        tag_id: { $in: [2] },
      });
      const insertRows = (driver.insertMany as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(insertRows).toEqual([{ post_id: 1, tag_id: 5 }]);
    });

    it("returns early for an empty id list", async () => {
      const post = new Post({ id: 1 });
      const ops = new PivotOperations(post, "tags", tagsDefinition, Post as never);
      await ops.toggle([]);
      expect(driver.deleteMany).not.toHaveBeenCalled();
      expect(driver.insertMany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // explicit pivot config overrides
  // ==========================================================================

  describe("explicit pivot configuration", () => {
    it("uses the configured pivot table and column names over conventions", async () => {
      const post = new Post({ id: 1 });
      const customDef: RelationDefinition = {
        type: "belongsToMany",
        model: "Tag",
        pivot: "post_tag_links",
        localKey: "post_ref",
        foreignKey: "tag_ref",
      };
      const ops = new PivotOperations(post, "tags", customDef, Post as never);
      await ops.detach([9]);

      expect(driver.deleteMany).toHaveBeenCalledWith("post_tag_links", {
        post_ref: 1,
        tag_ref: { $in: [9] },
      });
    });
  });
});
