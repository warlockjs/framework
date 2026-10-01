import { describe, expect, expectTypeOf, it } from "vitest";
import { ResponseStatus } from "../http";
import { defineResource } from "./define-resource";
import { nullable } from "./nullable-resource";
import type {
  ResponseBodyOutput,
  ResponseBodyValue,
  ResponseSchema,
  ResponseSchemaOutput,
} from "./types";

const UserResource = defineResource({ schema: { id: "number", name: "string?" } });
const PostResource = defineResource({ schema: { id: "number", title: "string" } });

type UserJson = { id: number; name: string | null };
type PostJson = { id: number; title: string };

describe("ResponseBodyValue", () => {
  it("accepts casts with suffixes, resources, resource arrays and nested objects", () => {
    const body = {
      token: "string",
      expiresAt: "number?",
      tags: "string[]",
      joined: "date[]?",
      user: UserResource,
      posts: [PostResource],
      meta: { count: "number", owner: { user: UserResource } },
      maybe: nullable(UserResource),
    } satisfies Record<string, ResponseBodyValue>;

    expect(Object.keys(body)).toHaveLength(8);
  });

  it("stays assignable for the original flat schema", () => {
    const schema = {
      200: { body: { user: UserResource, list: [UserResource], error: "string" } },
    } satisfies ResponseSchema;

    expect(schema[200].body.error).toBe("string");
  });

  it("rejects a cast the resource grammar does not know", () => {
    // @ts-expect-error "strng" is not a cast type
    const invalid: ResponseBodyValue = "strng";

    expect(invalid).toBe("strng");
  });
});

describe("ResponseBodyOutput", () => {
  it("resolves casts, resources, resource arrays and nested objects", () => {
    type Output = ResponseBodyOutput<{
      user: typeof UserResource;
      token: "string";
      tags: "string[]?";
      meta: { count: "number" };
      posts: [typeof PostResource];
    }>;

    expectTypeOf<Output>().toEqualTypeOf<{
      user: UserJson;
      token: string;
      tags: string[] | null;
      meta: { count: number };
      posts: PostJson[];
    }>();
  });

  it("maps nullable(Resource) to the resource output or null, also nested", () => {
    type Output = ResponseBodyOutput<{
      user: ReturnType<typeof nullable<typeof UserResource>>;
      meta: { owner: ReturnType<typeof nullable<typeof PostResource>>; count: "number" };
    }>;

    expectTypeOf<Output>().toEqualTypeOf<{
      user: UserJson | null;
      meta: { owner: PostJson | null; count: number };
    }>();
  });

  it("infers nullable(Resource) from a satisfies-checked body", () => {
    const schema = {
      200: { body: { user: nullable(UserResource), posts: [PostResource] } },
    } satisfies ResponseSchema;

    type Output = ResponseSchemaOutput<typeof schema>;

    expectTypeOf<Output[200]>().toEqualTypeOf<{ user: UserJson | null; posts: PostJson[] }>();
    expect(schema[200].body.user.resource).toBe(UserResource);
  });

  it("is readonly-agnostic so an `as const` body resolves the same way", () => {
    type Output = ResponseBodyOutput<{
      readonly ok: "boolean";
      readonly list: readonly [typeof UserResource];
    }>;

    expectTypeOf<Output>().toEqualTypeOf<{ ok: boolean; list: UserJson[] }>();
  });
});

describe("ResponseSchemaOutput", () => {
  it("maps each declared status to its body output", () => {
    const schema = {
      [ResponseStatus.OK]: { body: { user: UserResource, token: "string" } },
      [ResponseStatus.BAD_REQUEST]: { body: { error: "string" } },
    } satisfies ResponseSchema;

    type Output = ResponseSchemaOutput<typeof schema>;

    expectTypeOf<Output[200]>().toEqualTypeOf<{ user: UserJson; token: string }>();
    expectTypeOf<Output[400]>().toEqualTypeOf<{ error: string }>();
    expect(Object.keys(schema)).toEqual(["200", "400"]);
  });

  it("does not collapse to any", () => {
    type Output = ResponseSchemaOutput<{ 200: { body: { id: "number" } } }>;

    expectTypeOf<Output[200]["id"]>().not.toBeAny();
    expectTypeOf<Output[200]["id"]>().toEqualTypeOf<number>();
  });
});
