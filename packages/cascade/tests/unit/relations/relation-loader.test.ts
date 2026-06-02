/**
 * Unit tests for RelationLoader — the eager-loading engine that batches
 * related-model queries to avoid N+1.
 *
 * Strategy: register real Model subclasses, then spy on each related model's
 * static `query()` so it returns a recording fake query builder. The fake
 * captures `whereIn` / `where` calls and resolves `get()` with a fixed set of
 * already-hydrated Model instances. The pivot path goes through the data
 * source driver's `queryBuilder`, which the mock driver already stubs — we
 * override it per-test with a recording builder.
 *
 * This exercises the loader's grouping / indexing logic, key inference,
 * constraint application, nested recursion, and the dual-storage attach
 * contract, all without a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import {
  cleanupModelsRegistery,
  registerModelInRegistry,
} from "../../../src/model/register-model";
import {
  attachLoadedRelation,
  RelationLoader,
} from "../../../src/relations/relation-loader";
import type { RelationDefinition } from "../../../src/relations/types";
import { createMockDriver } from "../../utils/test-helpers";

// ============================================================================
// FAKE QUERY BUILDER
// ============================================================================

/**
 * A minimal recording query builder that satisfies the subset of the
 * contract RelationLoader actually touches: whereIn, where, select, and the
 * terminal get(). Records every call for assertions and resolves get() with
 * a caller-supplied list of records.
 */
function createFakeQuery(records: unknown[]) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query: Record<string, unknown> = {};

  for (const method of ["whereIn", "where", "select", "orderBy", "limit", "whereNotNull"]) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    });
  }

  query.get = vi.fn(async () => records);
  query.calls = calls;

  return query as Record<string, unknown> & {
    calls: Array<{ method: string; args: unknown[] }>;
    get: ReturnType<typeof vi.fn>;
  };
}

// ============================================================================
// MODELS
// ============================================================================

class Post extends Model {
  static table = "posts";
}

class Profile extends Model {
  static table = "profiles";
}

class Organization extends Model {
  static table = "organizations";
}

class Tag extends Model {
  static table = "tags";
}

class Comment extends Model {
  static table = "comments";
}

class User extends Model {
  static table = "users";
  static relations: Record<string, RelationDefinition> = {
    posts: { type: "hasMany", model: "Post" },
    profile: { type: "hasOne", model: "Profile" },
    organization: { type: "belongsTo", model: "Organization" },
    tags: { type: "belongsToMany", model: "Tag" },
    postsWithKeys: { type: "hasMany", model: "Post", foreignKey: "author_ref", localKey: "id" },
  };
}

// Post relations for nested-loading tests.
(Post as unknown as { relations: Record<string, RelationDefinition> }).relations = {
  comments: { type: "hasMany", model: "Comment" },
};

// Organization carries a single belongsTo relation so we can exercise the
// nested-loading branch where the parent relation resolved to ONE model.
(Organization as unknown as { relations: Record<string, RelationDefinition> }).relations = {
  owner: { type: "belongsTo", model: "Profile" },
};

// A model whose relation points at an unregistered string target, to hit the
// loader's "model is not registered" error path.
class Broken extends Model {
  static table = "broken";
  static relations: Record<string, RelationDefinition> = {
    ghost: { type: "hasMany", model: "DoesNotExist" },
  };
}

describe("relations/relation-loader", () => {
  beforeAll(() => {
    dataSourceRegistry.register({
      name: "test",
      driver: createMockDriver(),
      isDefault: true,
    });
    registerModelInRegistry("Post", Post);
    registerModelInRegistry("Profile", Profile);
    registerModelInRegistry("Organization", Organization);
    registerModelInRegistry("Tag", Tag);
    registerModelInRegistry("Comment", Comment);
    registerModelInRegistry("User", User);
    registerModelInRegistry("Broken", Broken);
  });

  afterAll(() => {
    dataSourceRegistry.clear();
    cleanupModelsRegistery();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // attachLoadedRelation (shared helper)
  // ==========================================================================

  describe("attachLoadedRelation", () => {
    it("creates a loadedRelations Map when absent and keeps property in sync", () => {
      const obj = {} as { loadedRelations?: Map<string, unknown>; posts?: unknown };
      attachLoadedRelation(obj, "posts", [1, 2] as never);

      expect(obj.loadedRelations).toBeInstanceOf(Map);
      expect(obj.posts).toEqual([1, 2]);
      expect(obj.loadedRelations!.get("posts")).toEqual([1, 2]);
    });

    it("reflects Map writes through the property getter", () => {
      const obj = { loadedRelations: new Map() } as {
        loadedRelations: Map<string, unknown>;
        posts?: unknown;
      };
      attachLoadedRelation(obj, "posts", "a" as never);
      obj.loadedRelations.set("posts", "b");
      expect(obj.posts).toBe("b");
    });

    it("reflects property writes back into the Map (setter)", () => {
      const obj = { loadedRelations: new Map() } as {
        loadedRelations: Map<string, unknown>;
        posts?: unknown;
      };
      attachLoadedRelation(obj, "posts", "a" as never);
      (obj as { posts: unknown }).posts = "c";
      expect(obj.loadedRelations.get("posts")).toBe("c");
    });

    it("installs an enumerable property so it is visible to Object.keys", () => {
      const obj = {} as Record<string, unknown>;
      attachLoadedRelation(obj, "posts", null);
      expect(Object.keys(obj)).toContain("posts");
    });
  });

  // ==========================================================================
  // load() short-circuits
  // ==========================================================================

  describe("load() guards", () => {
    it("does nothing when there are no models", async () => {
      const querySpy = vi.spyOn(Post, "query");
      const loader = new RelationLoader<User>([], User);
      await loader.load("posts");
      expect(querySpy).not.toHaveBeenCalled();
    });

    it("throws for an undefined relation name", async () => {
      const user = new User({ id: 1 });
      const loader = new RelationLoader([user], User);
      await expect(loader.load("ghost")).rejects.toThrow(
        /Relation "ghost" is not defined on model "User"/,
      );
    });

    it("throws a descriptive error when the relation target is not registered", async () => {
      const broken = new Broken({ id: 1 });
      const loader = new RelationLoader([broken], Broken);
      await expect(loader.load("ghost")).rejects.toThrow(
        /model "DoesNotExist" is not registered/,
      );
    });
  });

  // ==========================================================================
  // hasMany
  // ==========================================================================

  describe("hasMany", () => {
    it("batches a whereIn over the collected local keys and groups results", async () => {
      const users = [new User({ id: 1 }), new User({ id: 2 })];
      const posts = [
        new Post({ id: 10, user_id: 1 }),
        new Post({ id: 11, user_id: 1 }),
        new Post({ id: 12, user_id: 2 }),
      ];
      const fake = createFakeQuery(posts);
      vi.spyOn(Post, "query").mockReturnValue(fake as never);

      const loader = new RelationLoader(users, User);
      await loader.load("posts");

      // Default FK inferred from owner model name "User" → "user_id".
      expect(fake.calls[0]).toEqual({ method: "whereIn", args: ["user_id", [1, 2]] });
      expect((users[0].getRelation("posts") as Post[]).map((p) => p.get("id"))).toEqual([
        10, 11,
      ]);
      expect((users[1].getRelation("posts") as Post[])).toHaveLength(1);
    });

    it("assigns an empty array to a model with no matching children", async () => {
      const users = [new User({ id: 1 }), new User({ id: 2 })];
      const fake = createFakeQuery([new Post({ id: 10, user_id: 1 })]);
      vi.spyOn(Post, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("posts");
      expect(users[1].getRelation("posts")).toEqual([]);
    });

    it("short-circuits to empty arrays without querying when no local keys exist", async () => {
      const users = [new User({}), new User({})];
      const querySpy = vi.spyOn(Post, "query");

      await new RelationLoader(users, User).load("posts");

      expect(querySpy).not.toHaveBeenCalled();
      expect(users[0].getRelation("posts")).toEqual([]);
    });

    it("applies a constraint callback to the related query", async () => {
      const users = [new User({ id: 1 })];
      const fake = createFakeQuery([]);
      vi.spyOn(Post, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("posts", {
        posts: (q) => {
          (q as unknown as { where: (...a: unknown[]) => unknown }).where("status", "active");
        },
      });

      expect(fake.calls).toContainEqual({ method: "where", args: ["status", "active"] });
    });

    it("honours an explicit foreignKey/localKey from the definition", async () => {
      const users = [new User({ id: 5 })];
      const fake = createFakeQuery([]);
      vi.spyOn(Post, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("postsWithKeys");
      expect(fake.calls[0]).toEqual({ method: "whereIn", args: ["author_ref", [5]] });
    });

    it("dedupes repeated local-key values in the whereIn", async () => {
      const users = [new User({ id: 1 }), new User({ id: 1 }), new User({ id: 2 })];
      const fake = createFakeQuery([]);
      vi.spyOn(Post, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("posts");
      expect(fake.calls[0].args).toEqual(["user_id", [1, 2]]);
    });
  });

  // ==========================================================================
  // hasOne
  // ==========================================================================

  describe("hasOne", () => {
    it("indexes the first match per foreign key and assigns a single model", async () => {
      const users = [new User({ id: 1 }), new User({ id: 2 })];
      const profiles = [
        new Profile({ id: 100, user_id: 1 }),
        new Profile({ id: 101, user_id: 1 }), // duplicate FK — must be ignored
      ];
      const fake = createFakeQuery(profiles);
      vi.spyOn(Profile, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("profile");

      expect((users[0].getRelation("profile") as Profile).get("id")).toBe(100);
      expect(users[1].getRelation("profile")).toBeNull();
    });

    it("short-circuits to null without querying when no local keys exist", async () => {
      const users = [new User({})];
      const querySpy = vi.spyOn(Profile, "query");
      await new RelationLoader(users, User).load("profile");
      expect(querySpy).not.toHaveBeenCalled();
      expect(users[0].getRelation("profile")).toBeNull();
    });
  });

  // ==========================================================================
  // belongsTo
  // ==========================================================================

  describe("belongsTo", () => {
    it("collects the FK from this model and queries the owner key on the target", async () => {
      const users = [new User({ id: 1, organization_id: 7 }), new User({ id: 2, organization_id: 8 })];
      const orgs = [new Organization({ id: 7 }), new Organization({ id: 8 })];
      const fake = createFakeQuery(orgs);
      vi.spyOn(Organization, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("organization");

      // FK is inferred from the RELATION NAME ("organization" → organization_id),
      // queried against the owner key "id" on Organization.
      expect(fake.calls[0]).toEqual({ method: "whereIn", args: ["id", [7, 8]] });
      expect((users[0].getRelation("organization") as Organization).get("id")).toBe(7);
    });

    it("assigns null when the FK value has no matching owner", async () => {
      const users = [new User({ id: 1, organization_id: 99 })];
      const fake = createFakeQuery([]);
      vi.spyOn(Organization, "query").mockReturnValue(fake as never);

      await new RelationLoader(users, User).load("organization");
      expect(users[0].getRelation("organization")).toBeNull();
    });

    it("short-circuits to null when no models carry the foreign key", async () => {
      const users = [new User({ id: 1 })];
      const querySpy = vi.spyOn(Organization, "query");
      await new RelationLoader(users, User).load("organization");
      expect(querySpy).not.toHaveBeenCalled();
      expect(users[0].getRelation("organization")).toBeNull();
    });
  });

  // ==========================================================================
  // belongsToMany (pivot)
  // ==========================================================================

  describe("belongsToMany", () => {
    it("queries the pivot, collects related ids, then loads and groups targets", async () => {
      const users = [new User({ id: 1 }), new User({ id: 2 })];
      const driver = User.getDataSource().driver;

      const pivotRecords = [
        { user_id: 1, tag_id: 50 },
        { user_id: 1, tag_id: 51 },
        { user_id: 2, tag_id: 50 },
      ];
      const pivotFake = createFakeQuery(pivotRecords);
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(pivotFake as never);

      const tags = [new Tag({ id: 50 }), new Tag({ id: 51 })];
      const tagFake = createFakeQuery(tags);
      vi.spyOn(Tag, "query").mockReturnValue(tagFake as never);

      await new RelationLoader(users, User).load("tags");

      // Pivot table inferred alphabetically: "Tag" + "User" → "tag_user".
      expect(driver.queryBuilder).toHaveBeenCalledWith("tag_user");
      // Pivot local key inferred from owner ("user_id").
      expect(pivotFake.calls[0]).toEqual({ method: "whereIn", args: ["user_id", [1, 2]] });
      // Related ids deduped (50 appears twice).
      expect(tagFake.calls[0]).toEqual({ method: "whereIn", args: ["id", [50, 51]] });

      const user1Tags = users[0].getRelation("tags") as Tag[];
      expect(user1Tags.map((t) => t.get("id"))).toEqual([50, 51]);
      expect((users[1].getRelation("tags") as Tag[]).map((t) => t.get("id"))).toEqual([50]);
    });

    it("assigns empty arrays when the pivot has no rows", async () => {
      const users = [new User({ id: 1 })];
      const driver = User.getDataSource().driver;
      (driver.queryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        createFakeQuery([]) as never,
      );
      const tagSpy = vi.spyOn(Tag, "query");

      await new RelationLoader(users, User).load("tags");

      expect(tagSpy).not.toHaveBeenCalled();
      expect(users[0].getRelation("tags")).toEqual([]);
    });

    it("short-circuits before touching the pivot when no local keys exist", async () => {
      const users = [new User({})];
      const driver = User.getDataSource().driver;
      const qbSpy = driver.queryBuilder as ReturnType<typeof vi.fn>;
      qbSpy.mockClear();

      await new RelationLoader(users, User).load("tags");
      expect(qbSpy).not.toHaveBeenCalled();
      expect(users[0].getRelation("tags")).toEqual([]);
    });
  });

  // ==========================================================================
  // nested relations
  // ==========================================================================

  describe("nested relations (dot notation)", () => {
    it("loads a child relation on the already-loaded parent collection", async () => {
      const users = [new User({ id: 1 })];

      const posts = [new Post({ id: 10, user_id: 1 }), new Post({ id: 11, user_id: 1 })];
      vi.spyOn(Post, "query").mockReturnValue(createFakeQuery(posts) as never);

      const comments = [
        new Comment({ id: 100, post_id: 10 }),
        new Comment({ id: 101, post_id: 11 }),
      ];
      const commentFake = createFakeQuery(comments);
      vi.spyOn(Comment, "query").mockReturnValue(commentFake as never);

      await new RelationLoader(users, User).load("posts.comments");

      const loadedPosts = users[0].getRelation("posts") as Post[];
      // Nested loader collects post ids and batches a single comment query.
      expect(commentFake.calls[0]).toEqual({ method: "whereIn", args: ["post_id", [10, 11]] });
      expect((loadedPosts[0].getRelation("comments") as Comment[])[0].get("id")).toBe(100);
    });

    it("stops gracefully when the parent relation loaded nothing", async () => {
      const users = [new User({ id: 1 })];
      vi.spyOn(Post, "query").mockReturnValue(createFakeQuery([]) as never);
      const commentSpy = vi.spyOn(Comment, "query");

      await new RelationLoader(users, User).load("posts.comments");
      expect(commentSpy).not.toHaveBeenCalled();
    });

    it("nests through a single-model (belongsTo) parent relation", async () => {
      const users = [new User({ id: 1, organization_id: 7 })];

      // Parent: belongsTo Organization → resolves to ONE model per user.
      // Organization.owner is belongsTo Profile, so its FK is inferred from
      // the relation name "owner" → "owner_id" living on the Organization row.
      const org = new Organization({ id: 7, owner_id: 99 });
      vi.spyOn(Organization, "query").mockReturnValue(createFakeQuery([org]) as never);

      // The Profile's primary key must equal the org's owner_id (99) to match.
      const profile = new Profile({ id: 99 });
      const profileFake = createFakeQuery([profile]);
      vi.spyOn(Profile, "query").mockReturnValue(profileFake as never);

      await new RelationLoader(users, User).load("organization.owner");

      const loadedOrg = users[0].getRelation("organization") as Organization;
      // The nested loader queried the Profile owner key with the org's FK value.
      expect(profileFake.calls[0]).toEqual({ method: "whereIn", args: ["id", [99]] });
      expect((loadedOrg.getRelation("owner") as Profile).get("id")).toBe(99);
    });
  });

  // ==========================================================================
  // load() input shapes + model.load() integration
  // ==========================================================================

  describe("load() input shapes", () => {
    it("accepts an array of relation names", async () => {
      const users = [new User({ id: 1, organization_id: 7 })];
      vi.spyOn(Post, "query").mockReturnValue(createFakeQuery([]) as never);
      vi.spyOn(Organization, "query").mockReturnValue(
        createFakeQuery([new Organization({ id: 7 })]) as never,
      );

      await new RelationLoader(users, User).load(["posts", "organization"]);

      expect(users[0].getRelation("posts")).toEqual([]);
      expect((users[0].getRelation("organization") as Organization).get("id")).toBe(7);
    });

    it("is driven by model.load() which constructs its own loader", async () => {
      const user = new User({ id: 1 });
      const posts = [new Post({ id: 10, user_id: 1 })];
      vi.spyOn(Post, "query").mockReturnValue(createFakeQuery(posts) as never);

      await user.load("posts");
      expect((user.getRelation("posts") as Post[])[0].get("id")).toBe(10);
      expect(user.isLoaded("posts")).toBe(true);
    });
  });
});
