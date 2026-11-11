import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

/** `JSON.parse` keeps `__proto__` as an ordinary own key, as a request body does */
const body = (json: string) => JSON.parse(json);

describe("__proto__ keys in validated output", () => {
  it("a record refuses a __proto__ key", async () => {
    const schema = v.object({
      meta: v.record(v.object({ name: v.string().optional() }).allowUnknown()),
    });

    const result = await validate(schema, body('{"meta":{"__proto__":{"isAdmin":true}}}'));

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      {
        type: "forbiddenKey",
        error: "The meta contains a forbidden key: __proto__",
        input: "meta",
      },
    ]);
  });

  it("a nested allowUnknown() object keeps its prototype", async () => {
    const schema = v.object({
      settings: v.object({ theme: v.string().optional() }).allowUnknown(),
    });

    const result = await validate(schema, body('{"settings":{"__proto__":{"isAdmin":true}}}'));
    const settings = result.data?.settings as Record<string, unknown>;

    expect(result.isValid).toBe(true);
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    expect(settings.isAdmin).toBeUndefined();
  });

  it("a v.any() value keeps its prototype", async () => {
    const result = await validate(
      v.object({ tags: v.any() }),
      body('{"tags":{"__proto__":{"isAdmin":true},"ok":1}}'),
    );
    const tags = result.data?.tags as Record<string, unknown>;

    expect(Object.getPrototypeOf(tags)).toBe(Object.prototype);
    expect(tags.isAdmin).toBeUndefined();
    expect(tags).toEqual({ ok: 1 });
  });

  it("a top-level allowUnknown() output carries no __proto__ key", async () => {
    const schema = v.object({ name: v.string().optional() }).allowUnknown();

    const result = await validate(schema, body('{"__proto__":{"isAdmin":true},"extra":1}'));
    const data = result.data as Record<string, unknown>;

    expect(Object.keys(data)).toEqual(["extra"]);
    expect(Object.assign({}, data).isAdmin).toBeUndefined();
  });

  it("trim() keeps __proto__ an own key, so a strict object still refuses it", async () => {
    const schema = v.object({ role: v.string().optional() }).trim();

    const result = await validate(schema, body('{"__proto__":{"role":"admin"}}'));

    expect(result.isValid).toBe(false);
    expect(result.errors[0]?.type).toBe("unknownKeys");
  });

  it("stripUnknown() drops __proto__", async () => {
    const schema = v.object({ role: v.string().optional() }).stripUnknown();

    const result = await validate(schema, body('{"__proto__":{"role":"admin"}}'));

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({});
    expect((result.data as Record<string, unknown>).role).toBeUndefined();
  });

  it("constructor and prototype keys stay ordinary data", async () => {
    const result = await validate(
      v.object({ words: v.record(v.int()) }),
      body('{"words":{"constructor":1,"prototype":2}}'),
    );

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ words: { constructor: 1, prototype: 2 } });
  });
});
