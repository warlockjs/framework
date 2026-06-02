import { describe, expect, it } from "vitest";
import {
  jsonMutator,
  objectTrimMutator,
  stripUnknownMutator,
} from "../../../src/mutators/object-mutators";

describe("Object Mutators", () => {
  it("stripUnknown", async () => {
    const context = {
      ctx: { schema: { name: {}, age: {} } },
      options: {},
    } as any;

    const input = { name: "John", age: 30, extra: "remove" };
    const result = await stripUnknownMutator(input, context);
    expect(result).toEqual({ name: "John", age: 30 });
  });

  it("stripUnknown with allowedKeys", async () => {
    const context = {
      ctx: { schema: { name: {} } },
      options: { allowedKeys: ["email"] },
    } as any;

    const input = { name: "John", email: "john@example.com", extra: "remove" };
    const result = await stripUnknownMutator(input, context);
    expect(result).toEqual({ name: "John", email: "john@example.com" });
  });

  it("objectTrim non-recursive", async () => {
    const context = { options: { recursive: false } } as any;
    const input = { name: "  John  ", city: "  NYC  " };
    const result = await objectTrimMutator(input, context);
    expect(result).toEqual({ name: "John", city: "NYC" });
  });

  it("objectTrim recursive with nested objects", async () => {
    const context = { options: { recursive: true } } as any;
    const input = {
      name: "  John  ",
      address: {
        street: "  Main St  ",
        city: "  NYC  ",
      },
    };
    const result = await objectTrimMutator(input, context);
    expect(result).toEqual({
      name: "John",
      address: {
        street: "Main St",
        city: "NYC",
      },
    });
  });

  it("objectTrim recursive with arrays", async () => {
    const context = { options: { recursive: true } } as any;
    const input = {
      tags: ["  tag1  ", "  tag2  "],
    };
    const result = await objectTrimMutator(input, context);
    expect(result).toEqual({
      tags: ["tag1", "tag2"],
    });
  });

  it("json valid", async () => {
    const input = '{"name":"John","age":30}';
    const result = await jsonMutator(input);
    expect(result).toEqual({ name: "John", age: 30 });
  });

  it("json invalid", async () => {
    const input = "invalid json";
    const result = await jsonMutator(input);
    expect(result).toBe(input);
  });
});
