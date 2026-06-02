/**
 * Unit tests for RelationHydrator — the cache-restoration counterpart to
 * RelationLoader. It rebuilds related Model instances from a plain snapshot
 * object instead of issuing DB queries.
 *
 * Coverage focus: every branch of `hydrate` — null relations, single
 * (belongsTo/hasOne) relations, collection (hasMany/belongsToMany) relations,
 * nested recursion, unknown relation names, unregistered target classes, and
 * the dual-storage contract (loadedRelations Map + direct property).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import {
  cleanupModelsRegistery,
  registerModelInRegistry,
} from "../../../src/model/register-model";
import {
  RelationHydrator,
  type ModelSnapshot,
} from "../../../src/relations/relation-hydrator";
import type { RelationDefinition } from "../../../src/relations/types";
import { createMockDriver } from "../../utils/test-helpers";

class Author extends Model {
  static table = "authors";
}

class Comment extends Model {
  static table = "comments";
}

class Post extends Model {
  static table = "posts";
  static relations: Record<string, RelationDefinition> = {
    author: { type: "belongsTo", model: "Author" },
    comments: { type: "hasMany", model: "Comment" },
  };
}

describe("relations/relation-hydrator", () => {
  beforeAll(() => {
    dataSourceRegistry.register({
      name: "test",
      driver: createMockDriver(),
      isDefault: true,
    });
    registerModelInRegistry("Author", Author);
    registerModelInRegistry("Comment", Comment);
    registerModelInRegistry("Post", Post);
  });

  afterAll(() => {
    dataSourceRegistry.clear();
    cleanupModelsRegistery();
  });

  describe("hydrate (direct)", () => {
    it("returns early without touching the model when snapshot is undefined", () => {
      const post = new Post({ id: 1 });
      RelationHydrator.hydrate(post, Post.relations, undefined);
      expect(post.loadedRelations.size).toBe(0);
    });

    it("hydrates a single belongsTo relation into a Model instance", () => {
      const post = new Post({ id: 1 });
      RelationHydrator.hydrate(post, Post.relations, {
        author: { data: { id: 7, name: "Jane" }, relations: {} },
      });

      const author = post.loadedRelations.get("author");
      expect(author).toBeInstanceOf(Author);
      expect((author as Author).get("name")).toBe("Jane");
    });

    it("hydrates a hasMany collection into an array of Model instances", () => {
      const post = new Post({ id: 1 });
      RelationHydrator.hydrate(post, Post.relations, {
        comments: [
          { data: { id: 1, body: "a" }, relations: {} },
          { data: { id: 2, body: "b" }, relations: {} },
        ],
      });

      const comments = post.loadedRelations.get("comments") as Comment[];
      expect(comments).toHaveLength(2);
      expect(comments[0]).toBeInstanceOf(Comment);
      expect(comments[1].get("body")).toBe("b");
    });

    it("preserves an explicit null relation (loaded but resolved to nothing)", () => {
      const post = new Post({ id: 1 });
      RelationHydrator.hydrate(post, Post.relations, { author: null });

      expect(post.loadedRelations.has("author")).toBe(true);
      expect(post.loadedRelations.get("author")).toBeNull();
    });

    it("mirrors the relation onto both the Map and a direct property", () => {
      const post = new Post({ id: 1 });
      RelationHydrator.hydrate(post, Post.relations, {
        author: { data: { id: 7 }, relations: {} },
      });

      expect((post as unknown as { author: unknown }).author).toBe(
        post.loadedRelations.get("author"),
      );
    });

    it("skips a relation name that has no definition (older schema tolerance)", () => {
      const post = new Post({ id: 1 });
      RelationHydrator.hydrate(post, Post.relations, {
        ghost: { data: { id: 99 }, relations: {} },
      });

      expect(post.loadedRelations.has("ghost")).toBe(false);
    });

    it("skips a relation whose target class is not registered", () => {
      const post = new Post({ id: 1 });
      const orphanDefs: Record<string, RelationDefinition> = {
        widget: { type: "belongsTo", model: "Widget" },
      };
      RelationHydrator.hydrate(post, orphanDefs, {
        widget: { data: { id: 5 }, relations: {} },
      });

      expect(post.loadedRelations.has("widget")).toBe(false);
    });
  });

  describe("via Model.fromSnapshot", () => {
    it("reconstructs the root model data", () => {
      const snapshot: ModelSnapshot = {
        data: { id: 1, title: "Hello" },
        relations: {},
      };
      const post = Post.fromSnapshot(snapshot);
      expect(post).toBeInstanceOf(Post);
      expect(post.get("title")).toBe("Hello");
      // fromSnapshot goes through hydrate(), which marks the model persisted.
      expect(post.isNew).toBe(false);
    });

    it("recursively hydrates nested relations", () => {
      const snapshot: ModelSnapshot = {
        data: { id: 1, title: "Root" },
        relations: {
          author: { data: { id: 7, name: "Jane" }, relations: {} },
          comments: [{ data: { id: 11, body: "nice" }, relations: {} }],
        },
      };

      const post = Post.fromSnapshot(snapshot);
      expect((post.getRelation("author") as Author).get("name")).toBe("Jane");
      const comments = post.getRelation("comments") as Comment[];
      expect(comments[0]).toBeInstanceOf(Comment);
      expect(post.isLoaded("author")).toBe(true);
    });
  });
});
