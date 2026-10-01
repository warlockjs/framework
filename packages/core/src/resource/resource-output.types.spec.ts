import { lazy } from "@mongez/reinforcements";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineResource } from "./define-resource";
import type { ResourceConstructor } from "./resource";
import { ResourceFieldBuilder } from "./resource-field-builder";
import type { ResourceOutput } from "./types";

type DateOutput = { iso: string; format: string; timestamp: number; humanTime: string };

describe("defineResource output types", () => {
  it("infers the output from literal cast strings", () => {
    const UserResource = defineResource({
      schema: {
        id: "number",
        name: "string?",
        tags: "string[]",
        createdAt: "date",
        avatar: "url[]?",
      },
    });

    const json = new UserResource({}).toJSON();

    expectTypeOf(json).toEqualTypeOf<{
      id: number;
      name: string | null;
      tags: string[];
      createdAt: DateOutput;
      avatar: string[] | null;
    }>();
  });

  it("maps every base cast", () => {
    const Everything = defineResource({
      schema: {
        a: "string",
        b: "localized",
        c: "uploadsUrl",
        d: "storageUrl",
        e: "float",
        f: "int",
        g: "boolean?",
        h: "object",
        i: "array?",
        j: "date[]",
      },
    });

    expectTypeOf(new Everything({}).toJSON()).toEqualTypeOf<{
      a: string;
      b: string;
      c: string;
      d: string;
      e: number;
      f: number;
      g: boolean | null;
      h: Record<string, unknown>;
      i: unknown[] | null;
      j: DateOutput[];
    }>();
  });

  it("resolves nested, lazy, tuple, resolver, arrayOf, builder and self fields", () => {
    const AuthorResource = defineResource({ schema: { id: "number", name: "string" } });

    const PostResource = defineResource({
      schema: {
        author: AuthorResource,
        editor: lazy(() => AuthorResource),
        heading: ["title", "string"],
        slug: (value: unknown) => ({ x: 1 as number, value }),
        untyped: (value: any) => value,
        comments: {
          __type: "arrayOf",
          schema: { id: "number", body: "string?", by: ["author_name", "string"] },
        },
        built: new ResourceFieldBuilder("date"),
        parent: "self",
        children: "self[]",
      },
    });

    type PostJson = ResourceOutput<typeof PostResource>;

    expectTypeOf<PostJson["author"]>().toEqualTypeOf<{ id: number; name: string }>();
    expectTypeOf<PostJson["editor"]>().toEqualTypeOf<{ id: number; name: string }>();
    expectTypeOf<PostJson["heading"]>().toEqualTypeOf<string>();
    expectTypeOf<PostJson["slug"]>().toEqualTypeOf<{ x: number; value: unknown }>();
    expectTypeOf<PostJson["untyped"]>().toEqualTypeOf<unknown>();
    expectTypeOf<PostJson["comments"]>().toEqualTypeOf<
      { id: number; body: string | null; by: string }[]
    >();
    expectTypeOf<PostJson["built"]>().toEqualTypeOf<unknown>();
    expectTypeOf<PostJson["parent"]["heading"]>().toEqualTypeOf<string>();
    expectTypeOf<PostJson["parent"]["parent"]["heading"]>().toEqualTypeOf<string>();
    expectTypeOf<PostJson["children"][number]["author"]>().toEqualTypeOf<{
      id: number;
      name: string;
    }>();
  });

  it("keeps a nested-resource field required and non-nullable (an empty list is [], not undefined)", () => {
    const TagResource = defineResource({ schema: { label: "string" } });
    const PostResource = defineResource({ schema: { id: "number", tags: TagResource } });

    type PostJson = ResourceOutput<typeof PostResource>;

    expectTypeOf<PostJson>().toHaveProperty("tags");
    expectTypeOf<PostJson["tags"]>().not.toBeNullable();

    // A runtime [] input is what the field emits for an empty list.
    const json: Record<string, unknown> = new PostResource({ id: 1, tags: [] }).toJSON();
    expect(json.tags).toEqual([]);
  });

  it("ResourceOutput agrees for a class and an instance", () => {
    const UserResource = defineResource({ schema: { id: "number", name: "string" } });

    expectTypeOf<ResourceOutput<typeof UserResource>>().toEqualTypeOf<{
      id: number;
      name: string;
    }>();
    expectTypeOf<ResourceOutput<InstanceType<typeof UserResource>>>().toEqualTypeOf<
      ResourceOutput<typeof UserResource>
    >();
  });

  it("keeps untyped usages compiling", () => {
    const Untyped: ResourceConstructor = defineResource({
      schema: { id: "number", name: "string?" },
    });

    expectTypeOf(new Untyped({}).toJSON()).toEqualTypeOf<Record<string, any>>();
  });

  it("accepts an explicit output as a type argument or a cast", () => {
    type ProductJson = { id: number; title: string; priceLabel: string };

    const Explicit = defineResource<ProductJson>({
      schema: { id: "number", title: "string", price: "number" },
      transform: (data) => data,
    });

    expectTypeOf(new Explicit({}).toJSON()).toEqualTypeOf<ProductJson>();

    const Cast = defineResource({
      schema: { id: "number", title: "string" },
    }) as ResourceConstructor<ProductJson>;

    expectTypeOf(new Cast({}).toJSON()).toEqualTypeOf<ProductJson>();
  });

  it("matches the runtime output for the inferred casts", () => {
    const Runtime = defineResource({
      schema: { id: "number", name: "string?", tags: "string[]", missing: "string?" },
    });

    const json = new Runtime({ id: "7", name: "Ada", tags: [1, 2] }).toJSON();

    expect(json).toEqual({ id: 7, name: "Ada", tags: ["1", "2"], missing: null });
  });
});
