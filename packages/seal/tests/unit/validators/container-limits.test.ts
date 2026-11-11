import { afterEach, describe, expect, it } from "vitest";
import { configureSeal, resetSealConfig } from "../../../src/config";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { invalidRule, VALID_RULE } from "../../../src/helpers/validation-helpers";
import type { SchemaRule } from "../../../src/types";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

afterEach(() => resetSealConfig());

/** A rule that counts its calls and fails every value */
function failingSpyRule() {
  const spy = { calls: 0 };
  const rule: SchemaRule = {
    name: "spy",
    defaultErrorMessage: "The :input is refused",
    async validate(_value, context) {
      spy.calls++;
      return invalidRule(this, context);
    },
  };

  return { spy, rule };
}

describe("array and record size limits", () => {
  it("refuses an array longer than the default cap before validating any item", async () => {
    const { spy, rule } = failingSpyRule();
    const schema = v.object({ ids: v.array(v.int().useRule(rule)) });

    const result = await validate(schema, { ids: Array.from({ length: 10_001 }, () => 1) });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      { type: "maxItems", error: "The ids must not contain more than 10000 items", input: "ids" },
    ]);
    expect(spy.calls).toBe(0);
  });

  it("accepts an array at the default cap", async () => {
    const result = await validate(
      v.array(v.int()),
      Array.from({ length: 10_000 }, () => 1),
    );

    expect(result.isValid).toBe(true);
  });

  it("lets an explicit max replace the default cap", async () => {
    const items = Array.from({ length: 10_001 }, () => 1);

    expect((await validate(v.array(v.int()).max(20_000), items)).isValid).toBe(true);
    expect((await validate(v.array(v.int()).max(Infinity), items)).isValid).toBe(true);
    expect((await validate(v.array(v.int()).between(1, 20_000), items)).isValid).toBe(true);
  });

  it("reads the cap from configureSeal() and from the validate() options", async () => {
    configureSeal({ maxArrayItems: 3 });
    expect((await validate(v.array(v.int()), [1, 2, 3, 4])).errors[0]?.type).toBe("maxItems");

    configureSeal({ maxArrayItems: Infinity });
    expect((await validate(v.array(v.int()), [1, 2, 3, 4])).isValid).toBe(true);

    const perCall = await validate(v.array(v.int()), [1, 2, 3], { maxArrayItems: 2 });
    expect(perCall.errors[0]?.type).toBe("maxItems");
  });

  it("refuses a record with more keys than the default cap", async () => {
    const record: Record<string, number> = {};
    for (let index = 0; index < 10_001; index++) record[`k${index}`] = 1;

    const result = await validate(v.object({ meta: v.record(v.int()) }), { meta: record });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      { type: "maxKeys", error: "The meta must not contain more than 10000 keys", input: "meta" },
    ]);
  });

  it("supports a per-schema key cap with maxKeys()", async () => {
    const schema = v.record(v.int()).maxKeys(2);

    expect((await validate(schema, { a: 1, b: 2 })).isValid).toBe(true);
    expect((await validate(schema, { a: 1, b: 2, c: 3 })).errors[0]?.type).toBe("maxKeys");
    expect(schema.toJsonSchema().maxProperties).toBe(2);

    configureSeal({ maxRecordKeys: 1 });
    // The explicit cap wins over the global one
    expect((await validate(schema, { a: 1, b: 2 })).isValid).toBe(true);
    expect((await validate(v.record(v.int()), { a: 1, b: 2 })).errors[0]?.type).toBe("maxKeys");
  });
});

describe("item errors and concurrency", () => {
  it("stops validating items once the error limit is reached", async () => {
    const { spy, rule } = failingSpyRule();
    const items = Array.from({ length: 10_000 }, () => "x");

    const result = await validate(v.array(v.string().useRule(rule)), items);

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(100);
    // Two batches of 64 reach the limit; nothing after them runs.
    expect(spy.calls).toBeLessThanOrEqual(128);
  });

  it("honours maxErrors for records and keeps at least one error", async () => {
    const record: Record<string, string> = {};
    for (let index = 0; index < 500; index++) record[`k${index}`] = "x";

    configureSeal({ maxErrors: 5 });
    expect((await validate(v.record(v.int()), record)).errors).toHaveLength(5);

    configureSeal({ maxErrors: 0 });
    const result = await validate(v.record(v.int()), record);
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("keeps every item error below the limit, in item order", async () => {
    const result = await validate(v.array(v.int()), [1, "a", 2, "b"]);

    expect(result.errors.map((error) => error.input)).toEqual(["1", "3"]);
  });

  it("validates at most 64 items at the same time", async () => {
    let active = 0;
    let peak = 0;
    const slowRule: SchemaRule = {
      name: "slow",
      async validate() {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return VALID_RULE;
      },
    };

    const items = Array.from({ length: 200 }, (_, index) => index);
    const result = await validate(v.array(v.int().useRule(slowRule)), items);

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual(items);
    expect(peak).toBeLessThanOrEqual(64);
  });
});

describe("unknown keys message", () => {
  it("lists at most 10 unknown keys", async () => {
    const input: Record<string, number> = {};
    for (let index = 0; index < 30; index++) input[`k${index}`] = 1;

    const result = await validate(v.object({}), input);

    expect(result.errors[0]?.error).toBe(
      "The schema contains unknown keys: k0, k1, k2, k3, k4, k5, k6, k7, k8, k9 and 20 more",
    );
  });

  it("lists every key when there are 10 or fewer", async () => {
    const result = await validate(v.object({}), { a: 1, b: 2 });

    expect(result.errors[0]?.error).toBe("The schema contains unknown keys: a, b");
  });
});

describe("container mutators run once", () => {
  function countingMutator() {
    const counter = { calls: 0 };
    const mutator = async (data: unknown) => {
      counter.calls++;
      return data;
    };

    return { counter, mutator };
  }

  it("object", async () => {
    const { counter, mutator } = countingMutator();
    const result = await validate(v.object({ a: v.string() }).addMutator(mutator), { a: "x" });

    expect(result.data).toEqual({ a: "x" });
    expect(counter.calls).toBe(1);
  });

  it("array", async () => {
    const { counter, mutator } = countingMutator();
    const result = await validate(v.array(v.string()).addMutator(mutator), ["x"]);

    expect(result.data).toEqual(["x"]);
    expect(counter.calls).toBe(1);
  });

  it("record", async () => {
    const { counter, mutator } = countingMutator();
    const result = await validate(v.record(v.string()).addMutator(mutator), { a: "x" });

    expect(result.data).toEqual({ a: "x" });
    expect(counter.calls).toBe(1);
  });

  it("tuple", async () => {
    const { counter, mutator } = countingMutator();
    const result = await validate(v.tuple([v.string()]).addMutator(mutator), ["x"]);

    expect(result.data).toEqual(["x"]);
    expect(counter.calls).toBe(1);
  });

  it("a mutated default is still validated once", async () => {
    const { counter, mutator } = countingMutator();
    const schema = v.object({ tags: v.array(v.string()).default(["a"]).addMutator(mutator) });

    const result = await validate(schema, {});

    expect(result.data).toEqual({ tags: ["a"] });
    expect(counter.calls).toBe(1);
  });

  it("an in-place transformer on the container does not change what the items see", async () => {
    const schema = v.array(v.int()).outputAs((items: number[]) => items.reverse());

    expect((await validate(schema, [1, 2, 3])).data).toEqual([3, 2, 1]);
  });

  it("object trim and stripUnknown still apply once", async () => {
    const schema = v.object({ name: v.string() }).trim().stripUnknown();

    expect((await validate(schema, { name: "  a  ", extra: 1 })).data).toEqual({ name: "a" });
  });
});
