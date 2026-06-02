import { beforeEach, describe, expect, it } from "vitest";
import { defineResource } from "../../../src/resource/define-resource";
import { Resource } from "../../../src/resource/resource";
import { setBaseUrl } from "../../../src/utils/urls";

beforeEach(() => {
  setBaseUrl("https://store.test");
});

describe("model -> wire mapping", () => {
  it("keeps only declared fields and casts them", () => {
    const UserResource = defineResource({
      schema: { id: "int", name: "string", active: "boolean" },
    });

    const json = new UserResource({
      id: "5",
      name: "Hasan",
      active: 1,
      password: "secret",
    }).toJSON();

    expect(json).toEqual({ id: 5, name: "Hasan", active: true });
  });

  it("omits a field whose value is undefined", () => {
    const UserResource = defineResource({
      schema: { id: "int", nickname: "string" },
    });

    const json = new UserResource({ id: 1 }).toJSON();

    expect(json).toEqual({ id: 1 });
    expect("nickname" in json).toBe(false);
  });

  it("includes a nullable field as null when absent", () => {
    const UserResource = defineResource({
      schema: { id: "int", bio: "string?" },
    });

    const json = new UserResource({ id: 1 }).toJSON();

    expect(json).toEqual({ id: 1, bio: null });
  });
});

describe("field rename via [inputKey, castType] tuple", () => {
  it("reads from the input key and writes under the output key", () => {
    const UserResource = defineResource({
      schema: {
        fullName: ["name", "string"],
        id: "int",
      },
    });

    const json = new UserResource({ id: 1, name: "Hasan" }).toJSON();

    expect(json).toEqual({ id: 1, fullName: "Hasan" });
  });
});

describe("resolver functions", () => {
  it("computes a value and can read other fields via this.get", () => {
    const UserResource = defineResource({
      schema: {
        id: "int",
        greeting(this: Resource) {
          return `Hi ${this.get("name")}`;
        },
      },
    });

    const json = new UserResource({ id: 1, name: "Hasan" }).toJSON();

    expect(json).toEqual({ id: 1, greeting: "Hi Hasan" });
  });
});

describe("nested resources", () => {
  it("serializes a single nested resource", () => {
    const AddressResource = defineResource({
      schema: { city: "string", zip: "string" },
    });

    const UserResource = defineResource({
      schema: { id: "int", address: AddressResource },
    });

    const json = new UserResource({
      id: 1,
      address: { city: "Cairo", zip: "11511", country: "EG" },
    }).toJSON();

    expect(json).toEqual({
      id: 1,
      address: { city: "Cairo", zip: "11511" },
    });
  });

  it("serializes an array of nested resources", () => {
    const TagResource = defineResource({
      schema: { label: "string" },
    });

    const PostResource = defineResource({
      schema: { id: "int", tags: TagResource },
    });

    const json = new PostResource({
      id: 1,
      tags: [{ label: "news" }, { label: "tech" }],
    }).toJSON();

    expect(json).toEqual({
      id: 1,
      tags: [{ label: "news" }, { label: "tech" }],
    });
  });

  it("omits a nested resource when the value is missing", () => {
    const AddressResource = defineResource({ schema: { city: "string" } });
    const UserResource = defineResource({
      schema: { id: "int", address: AddressResource },
    });

    const json = new UserResource({ id: 1 }).toJSON();

    expect(json).toEqual({ id: 1 });
  });
});

describe("self references", () => {
  it("resolves a single self field with 'self'", () => {
    const CategoryResource = defineResource({
      schema: { id: "int", name: "string", parent: "self" },
    });

    const json = new CategoryResource({
      id: 2,
      name: "Phones",
      parent: { id: 1, name: "Electronics" },
    }).toJSON();

    expect(json).toEqual({
      id: 2,
      name: "Phones",
      parent: { id: 1, name: "Electronics" },
    });
  });

  it("resolves an array of self fields with 'self[]'", () => {
    const CategoryResource = defineResource({
      schema: { id: "int", name: "string", children: "self[]" },
    });

    const json = new CategoryResource({
      id: 1,
      name: "Electronics",
      children: [
        { id: 2, name: "Phones" },
        { id: 3, name: "Laptops" },
      ],
    }).toJSON();

    expect(json).toEqual({
      id: 1,
      name: "Electronics",
      children: [
        { id: 2, name: "Phones" },
        { id: 3, name: "Laptops" },
      ],
    });
  });

  it("breaks a circular self reference, bounding the recursion", () => {
    const NodeResource = defineResource({
      schema: { id: "int", parent: "self" },
    });

    const a: Record<string, unknown> = { id: 1 };
    const b: Record<string, unknown> = { id: 2, parent: a };
    a.parent = b;

    const json = new NodeResource(a).toJSON();

    // The root node (a) is constructed directly, not via resolveSelf, so its
    // own identity is not seeded into the seen-set. a -> b -> a runs once more
    // before the cycle is detected and recursion stops. The key guarantee is
    // that it terminates rather than recursing forever.
    expect(json).toEqual({ id: 1, parent: { id: 2, parent: { id: 1 } } });
  });
});

describe("arrayOf structured arrays", () => {
  // NOTE: arrayOf sub-schemas must use field builders (this.string(), this.int()).
  // Plain string cast types ("string", "int") are NOT normalized inside arrayOf
  // and currently serialize to empty objects — see the bug report in the summary.
  it("exposes an arrayOf builder descriptor", () => {
    const resource = new Resource({});
    const arraySchema = resource.arrayOf({
      sku: resource.string(),
      qty: resource.int(),
    });

    expect(arraySchema.__type).toBe("arrayOf");
    expect(Object.keys(arraySchema.schema)).toEqual(["sku", "qty"]);
  });

  it("transforms array items via a builder-based arrayOf schema", () => {
    const OrderLineResource = defineResource({
      schema: {
        id: "int",
        lines: {
          __type: "arrayOf" as const,
          schema: {
            sku: new Resource({}).string(),
            qty: new Resource({}).int(),
          },
        },
      },
    });

    const json = new OrderLineResource({
      id: 9,
      lines: [
        { sku: "A1", qty: "2", note: "drop" },
        { sku: "B2", qty: "1" },
      ],
    }).toJSON();

    expect(json).toEqual({
      id: 9,
      lines: [
        { sku: "A1", qty: 2 },
        { sku: "B2", qty: 1 },
      ],
    });
  });
});

describe("defineResource hooks", () => {
  it("runs transform() to reshape the final output by mutating data in place", () => {
    // The transform hook's return value is ignored — it must mutate the passed
    // data object directly.
    const CategoryResource = defineResource({
      schema: { id: "int", name: "string" },
      transform: (data) => {
        data.slug = String(data.name).toLowerCase();

        return data;
      },
    });

    const json = new CategoryResource({ id: 1, name: "Books" }).toJSON();

    expect(json).toEqual({ id: 1, name: "Books", slug: "books" });
  });

  it("runs boot() before transformation", () => {
    const order: string[] = [];

    const R = defineResource({
      schema: { id: "int" },
      boot: () => {
        order.push("boot");
      },
      extend: () => {
        order.push("extend");
      },
    });

    new R({ id: 1 }).toJSON();

    expect(order).toEqual(["boot", "extend"]);
  });
});

describe("Resource accepts plain objects, resources, and dotted keys", () => {
  it("reads nested input via dot notation", () => {
    const R = defineResource({
      schema: { city: ["address.city", "string"] },
    });

    const json = new R({ address: { city: "Giza" } }).toJSON();

    expect(json).toEqual({ city: "Giza" });
  });

  it("wraps another resource by reusing its already-serialized data", () => {
    // Resource wraps the other resource's `data` (its serialized output), which
    // is only populated after toJSON() runs. Serialize the inner one first.
    const Inner = defineResource({ schema: { id: "int", name: "string" } });
    const inner = new Inner({ id: 1, name: "Hasan" });

    inner.toJSON();

    const Outer = defineResource({ schema: { id: "int", name: "string" } });
    const json = new Outer(inner).toJSON();

    expect(json).toEqual({ id: 1, name: "Hasan" });
  });
});
