import { describe, expect, it } from "vitest";
import { Resource } from "./resource";

/**
 * C1 B9: a class resource without `@RegisterResource()` serialized to `{}`
 * because `parsedSchema` was inherited from the base as `{}`.
 */
describe("Resource without @RegisterResource()", () => {
  it("serializes from its own static schema", () => {
    class PostResource extends Resource {
      public static schema = { id: "int", title: "string" };
    }

    expect(new PostResource({ id: "7", title: "Hi", secret: "x" }).toJSON()).toEqual({
      id: 7,
      title: "Hi",
    });
  });

  it("keeps sibling resources isolated", () => {
    class A extends Resource {
      public static schema = { a: "string" };
    }
    class B extends Resource {
      public static schema = { b: "string" };
    }

    expect(new A({ a: "1", b: "2" }).toJSON()).toEqual({ a: "1" });
    expect(new B({ a: "1", b: "2" }).toJSON()).toEqual({ b: "2" });
  });

  it("throws a clear error naming the class when there is no schema", () => {
    class EmptyResource extends Resource {}

    expect(() => new EmptyResource({ id: 1 }).toJSON()).toThrow(/EmptyResource/);
  });
});
