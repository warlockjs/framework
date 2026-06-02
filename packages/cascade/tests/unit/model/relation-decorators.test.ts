/**
 * Unit tests for the TC39 stage-3 relation field decorators
 * (@BelongsTo / @HasOne / @HasMany / @BelongsToMany).
 *
 * The decorators stash a RelationDefinition into class decorator metadata;
 * @RegisterModel hoists that metadata onto the class's static `relations`
 * map. We assert the resulting definitions rather than the metadata internals,
 * since `relations` is the public contract consumed by the loader and pivot ops.
 *
 * The vitest esbuild plugin compiles these decorators, so they run natively.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import {
  BelongsTo,
  BelongsToMany,
  HasMany,
  HasOne,
} from "../../../src/model/relation-decorators";
import {
  cleanupModelsRegistery,
  RegisterModel,
} from "../../../src/model/register-model";
import type { RelationDefinition } from "../../../src/relations/types";

function relationsOf(ModelClass: unknown): Record<string, RelationDefinition> {
  return (ModelClass as { relations: Record<string, RelationDefinition> }).relations;
}

describe("model/relation-decorators", () => {
  beforeEach(() => {
    cleanupModelsRegistery();
  });

  afterEach(() => {
    cleanupModelsRegistery();
  });

  describe("definition shape per relation type", () => {
    it("records a belongsTo with the field name and string model ref", () => {
      @RegisterModel()
      class Post extends Model {
        static table = "posts";
        @BelongsTo("User") author?: unknown;
      }

      const def = relationsOf(Post).author;
      expect(def.type).toBe("belongsTo");
      expect(def.model).toBe("User");
      // No options → all inferred keys stay undefined for runtime resolution.
      expect(def.foreignKey).toBeUndefined();
      expect(def.localKey).toBeUndefined();
    });

    it("records hasOne / hasMany / belongsToMany types from their decorators", () => {
      @RegisterModel()
      class User extends Model {
        static table = "users";
        @HasOne("Profile") profile?: unknown;
        @HasMany("Post") posts?: unknown;
        @BelongsToMany("Role") roles?: unknown;
      }

      const rels = relationsOf(User);
      expect(rels.profile.type).toBe("hasOne");
      expect(rels.posts.type).toBe("hasMany");
      expect(rels.roles.type).toBe("belongsToMany");
      expect(rels.posts.model).toBe("Post");
    });

    it("maps belongsTo ownerKey into the shared localKey slot", () => {
      @RegisterModel()
      class Post extends Model {
        static table = "posts";
        @BelongsTo("User", { ownerKey: "uuid", foreignKey: "user_uuid" })
        author?: unknown;
      }

      const def = relationsOf(Post).author;
      expect(def.localKey).toBe("uuid");
      expect(def.foreignKey).toBe("user_uuid");
    });

    it("passes localKey through directly for non-belongsTo relations", () => {
      @RegisterModel()
      class User extends Model {
        static table = "users";
        @HasMany("Post", { localKey: "uuid", foreignKey: "author_uuid" })
        posts?: unknown;
      }

      const def = relationsOf(User).posts;
      expect(def.localKey).toBe("uuid");
      expect(def.foreignKey).toBe("author_uuid");
    });

    it("records pivot fields for belongsToMany", () => {
      @RegisterModel()
      class Post extends Model {
        static table = "posts";
        @BelongsToMany("Tag", {
          pivot: "post_tags",
          pivotLocalKey: "post_uuid",
          pivotForeignKey: "tag_uuid",
          select: ["id", "name"],
        })
        tags?: unknown;
      }

      const def = relationsOf(Post).tags;
      expect(def.pivot).toBe("post_tags");
      expect(def.pivotLocalKey).toBe("post_uuid");
      expect(def.pivotForeignKey).toBe("tag_uuid");
      expect(def.select).toEqual(["id", "name"]);
    });
  });

  describe("string shorthand for the second argument", () => {
    it("treats a bare string as { foreignKey }", () => {
      @RegisterModel()
      class Post extends Model {
        static table = "posts";
        @BelongsTo("User", "writer_id") author?: unknown;
      }

      expect(relationsOf(Post).author.foreignKey).toBe("writer_id");
    });
  });

  describe("model reference forms", () => {
    it("accepts a direct class reference as the model", () => {
      class Organization extends Model {
        static table = "organizations";
      }

      @RegisterModel()
      class User extends Model {
        static table = "users";
        @BelongsTo(Organization) organization?: unknown;
      }

      expect(relationsOf(User).organization.model).toBe(Organization);
    });
  });

  describe("inheritance", () => {
    it("a subclass inherits parent relations without leaking its own back up", () => {
      @RegisterModel({ name: "BaseEntity" })
      class BaseEntity extends Model {
        static table = "base";
        @BelongsTo("Organization") organization?: unknown;
      }

      @RegisterModel({ name: "ChildEntity" })
      class ChildEntity extends BaseEntity {
        static table = "child";
        @HasMany("Post") posts?: unknown;
      }

      const childRels = relationsOf(ChildEntity);
      expect(childRels.organization?.type).toBe("belongsTo");
      expect(childRels.posts?.type).toBe("hasMany");

      // Parent must NOT have gained the child-only relation.
      const baseRels = relationsOf(BaseEntity);
      expect(baseRels.posts).toBeUndefined();
      expect(baseRels.organization?.type).toBe("belongsTo");
    });
  });

  describe("guards", () => {
    it("throws when a relation decorator is applied to a non-field element", () => {
      const decorate = HasMany("Post");
      const badContext = {
        kind: "method",
        name: "posts",
        metadata: {},
      } as unknown as ClassFieldDecoratorContext;

      expect(() => decorate(undefined, badContext)).toThrow(
        /can only be applied to class fields/,
      );
    });
  });
});
