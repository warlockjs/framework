import { lazy } from "@mongez/reinforcements";
import { describe, expect, it } from "vitest";
import { defineResource } from "./define-resource";
import { isNullableResource, nullable, NULLABLE_RESOURCE } from "./nullable-resource";
import { ResourceFieldBuilder } from "./resource-field-builder";

const UserResource = defineResource({ schema: { id: "number", name: "string" } });

describe("nullable()", () => {
  it("returns a marker holding the resource", () => {
    const marker = nullable(UserResource);

    expect(marker.resource).toBe(UserResource);
    expect(marker[NULLABLE_RESOURCE]).toBe(true);
    expect(NULLABLE_RESOURCE).toBe(Symbol.for("warlock.resource.nullable"));
    expect(isNullableResource(marker)).toBe(true);
  });

  it("is not confused with a resource, a plain object or an empty value", () => {
    expect(isNullableResource(UserResource)).toBe(false);
    expect(isNullableResource({ resource: UserResource })).toBe(false);
    expect(isNullableResource(null)).toBe(false);
    expect(isNullableResource(undefined)).toBe(false);
  });
});

describe("nullable resource field in defineResource", () => {
  const PostResource = defineResource({
    schema: { id: "number", author: nullable(UserResource) },
  });

  it("outputs the resource when there is a value", () => {
    expect(new PostResource({ id: 1, author: { id: 2, name: "Ada" } }).toJSON()).toEqual({
      id: 1,
      author: { id: 2, name: "Ada" },
    });
  });

  it("outputs null (not omitted) for a null input", () => {
    const json = new PostResource({ id: 1, author: null }).toJSON();

    expect(json).toHaveProperty("author", null);
  });

  it("outputs null (not omitted) for a missing input", () => {
    const json = new PostResource({ id: 1 }).toJSON();

    expect(json).toHaveProperty("author", null);
  });

  it("leaves a plain resource field omitted for a missing input (back-compat)", () => {
    const Plain = defineResource({ schema: { id: "number", author: UserResource } });

    expect(new Plain({ id: 1 }).toJSON()).not.toHaveProperty("author");
  });

  it("works for a lazy resource", () => {
    const Lazily = defineResource({
      schema: { id: "number", author: nullable(lazy(() => UserResource)) },
    });

    expect(new Lazily({ id: 1, author: { id: 3, name: "Bo" } }).toJSON()).toEqual({
      id: 1,
      author: { id: 3, name: "Bo" },
    });
    expect(new Lazily({ id: 1 }).toJSON()).toHaveProperty("author", null);
  });

  it("works when nested inside another resource", () => {
    const CommentResource = defineResource({
      schema: { body: "string", post: nullable(PostResource) },
    });

    expect(
      new CommentResource({ body: "hi", post: { id: 1, author: null } }).toJSON(),
    ).toEqual({ body: "hi", post: { id: 1, author: null } });
    expect(new CommentResource({ body: "hi" }).toJSON()).toEqual({ body: "hi", post: null });
  });

  it("works inside an arrayOf item schema", () => {
    const Feed = defineResource({
      schema: {
        items: {
          __type: "arrayOf",
          schema: { id: new ResourceFieldBuilder("number"), author: nullable(UserResource) },
        },
      },
    });

    expect(
      new Feed({
        items: [
          { id: 1, author: { id: 2, name: "Ada" } },
          { id: 2, author: null },
        ],
      }).toJSON(),
    ).toEqual({
      items: [
        { id: 1, author: { id: 2, name: "Ada" } },
        { id: 2, author: null },
      ],
    });
  });
});

describe("[Resource] list field in defineResource", () => {
  const TagResource = defineResource({ schema: { id: "number", label: "string" } });
  const PostResource = defineResource({ schema: { id: "number", tags: [TagResource] } });

  it("maps each item through the resource", () => {
    expect(
      new PostResource({
        id: 1,
        tags: [
          { id: 1, label: "a", secret: "x" },
          { id: 2, label: "b" },
        ],
      }).toJSON(),
    ).toEqual({
      id: 1,
      tags: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ],
    });
  });

  it("keeps an empty list as []", () => {
    expect(new PostResource({ id: 1, tags: [] }).toJSON()).toEqual({ id: 1, tags: [] });
  });

  it("omits the field for a null or missing input", () => {
    expect(new PostResource({ id: 1, tags: null }).toJSON()).toEqual({ id: 1 });
    expect(new PostResource({ id: 1 }).toJSON()).toEqual({ id: 1 });
  });

  it("works nested inside another resource", () => {
    const Wrapper = defineResource({ schema: { post: PostResource, posts: [PostResource] } });

    expect(
      new Wrapper({
        post: { id: 1, tags: [{ id: 1, label: "a" }] },
        posts: [{ id: 2, tags: [] }, { id: 3 }],
      }).toJSON(),
    ).toEqual({
      post: { id: 1, tags: [{ id: 1, label: "a" }] },
      posts: [{ id: 2, tags: [] }, { id: 3 }],
    });
  });

  it("works inside an arrayOf item schema", () => {
    const Wrapper = defineResource({
      schema: {
        rows: { __type: "arrayOf", schema: { id: new ResourceFieldBuilder("number"), tags: [TagResource] } },
      },
    });

    expect(
      new Wrapper({ rows: [{ id: 1, tags: [{ id: 1, label: "a" }] }, { id: 2, tags: [] }] }).toJSON(),
    ).toEqual({
      rows: [
        { id: 1, tags: [{ id: 1, label: "a" }] },
        { id: 2, tags: [] },
      ],
    });
  });

  it("keeps a plain resource field mapping an array exactly as before", () => {
    const Plain = defineResource({ schema: { tags: TagResource } });

    expect(new Plain({ tags: [{ id: 1, label: "a" }] }).toJSON()).toEqual({
      tags: [{ id: 1, label: "a" }],
    });
    expect(new Plain({ tags: [] }).toJSON()).toEqual({ tags: [] });
    expect(new Plain({ tags: { id: 1, label: "a" } }).toJSON()).toEqual({
      tags: { id: 1, label: "a" },
    });
  });
});
