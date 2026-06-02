/**
 * Unit tests for the foreign-key / pivot naming conventions.
 *
 * These are pure functions — no driver, registry, or data source needed.
 * They are the single source of truth for default column / table names when
 * a relation omits explicit keys, so every branch (acronym snaking, suffix
 * override, pivot ordering) is pinned here.
 */
import { describe, expect, it } from "vitest";
import {
  inferBelongsToForeignKey,
  inferHasForeignKey,
  inferPivotKey,
  inferPivotTable,
} from "../../../src/relations/key-conventions";

describe("relations/key-conventions", () => {
  describe("inferBelongsToForeignKey", () => {
    it("appends _id to a simple lower-case relation name", () => {
      expect(inferBelongsToForeignKey("author")).toBe("author_id");
    });

    it("keeps an already-snake relation name idempotent", () => {
      expect(inferBelongsToForeignKey("organization")).toBe("organization_id");
    });

    it("snake-cases a camelCase relation name", () => {
      expect(inferBelongsToForeignKey("parentItem")).toBe("parent_item_id");
    });

    it("honours a custom foreignKeySuffix override", () => {
      expect(inferBelongsToForeignKey("author", { foreignKeySuffix: "Id" })).toBe("authorId");
    });

    it("allows an empty suffix", () => {
      expect(inferBelongsToForeignKey("author", { foreignKeySuffix: "" })).toBe("author");
    });

    it("falls back to the default suffix when options omit it", () => {
      expect(inferBelongsToForeignKey("author", {})).toBe("author_id");
    });
  });

  describe("inferHasForeignKey", () => {
    it("derives the FK from the owning model class name", () => {
      expect(inferHasForeignKey("User")).toBe("user_id");
    });

    it("snake-cases a PascalCase model name", () => {
      expect(inferHasForeignKey("BlogPost")).toBe("blog_post_id");
    });

    it("snakes an acronym-prefixed model name correctly", () => {
      // The wrapper splits a run of caps from the trailing cap+lower.
      expect(inferHasForeignKey("AIModel")).toBe("ai_model_id");
    });

    it("snakes a fully-acronym model name", () => {
      expect(inferHasForeignKey("HTTPSConnection")).toBe("https_connection_id");
    });

    it("honours a custom suffix override", () => {
      expect(inferHasForeignKey("User", { foreignKeySuffix: "_ref" })).toBe("user_ref");
    });
  });

  describe("inferPivotKey", () => {
    it("derives the pivot column for a model name", () => {
      expect(inferPivotKey("Post")).toBe("post_id");
      expect(inferPivotKey("Tag")).toBe("tag_id");
    });

    it("snakes a multi-word model name", () => {
      expect(inferPivotKey("UserGroup")).toBe("user_group_id");
    });

    it("honours a custom suffix override", () => {
      expect(inferPivotKey("Tag", { foreignKeySuffix: "Id" })).toBe("tagId");
    });
  });

  describe("inferPivotTable", () => {
    it("joins two model names alphabetically by default", () => {
      expect(inferPivotTable("Post", "Tag")).toBe("post_tag");
    });

    it("sorts alphabetically regardless of declaring side", () => {
      // "group" sorts before "user" so both declaration orders agree.
      expect(inferPivotTable("User", "Group")).toBe("group_user");
      expect(inferPivotTable("Group", "User")).toBe("group_user");
    });

    it("snakes acronym names before joining", () => {
      expect(inferPivotTable("AIModel", "Tenant")).toBe("ai_model_tenant");
    });

    it("uses owner-first ordering when configured", () => {
      expect(
        inferPivotTable("Post", "Tag", { pivotTableNamingOrder: "owner_first" }),
      ).toBe("post_tag");
      expect(
        inferPivotTable("Tag", "Post", { pivotTableNamingOrder: "owner_first" }),
      ).toBe("tag_post");
    });

    it("owner-first keeps the owner segment first even when it sorts later", () => {
      // "user" sorts after "group" alphabetically; owner_first must NOT sort.
      expect(
        inferPivotTable("User", "Group", { pivotTableNamingOrder: "owner_first" }),
      ).toBe("user_group");
    });

    it("defaults to alphabetical when ordering option is omitted", () => {
      expect(inferPivotTable("Zebra", "Apple", {})).toBe("apple_zebra");
    });
  });
});
