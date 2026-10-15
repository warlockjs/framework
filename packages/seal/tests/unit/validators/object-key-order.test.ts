import { describe, expect, it } from "vitest";
import { v } from "../../../src";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** String validator whose async rule settles after `ms`, passing the value through. */
const slowString = (ms: number) =>
  v.string().refine(async () => {
    await sleep(ms);

    return undefined;
  });

/** Same, but always fails after `ms`. */
const slowFailing = (ms: number, message: string) =>
  v.string().refine(async () => {
    await sleep(ms);

    return message;
  });

describe("v.object output key order", () => {
  it("emits keys in declared order regardless of validator completion order", async () => {
    // Declared first-to-last, but finishing last-to-first.
    const schema = v.object({
      breakfast: slowString(40),
      lunch: slowString(20),
      dinner: slowString(1),
    });

    const result = await v.validate(schema, { dinner: "d", lunch: "l", breakfast: "b" });

    expect(result.isValid).toBe(true);
    expect(Object.keys(result.data)).toEqual(["breakfast", "lunch", "dinner"]);
    expect(result.data).toEqual({ breakfast: "b", lunch: "l", dinner: "d" });
  });

  it("orders nested objects by their own declared shape", async () => {
    const schema = v.object({
      meals: v.object({
        morning: slowString(40),
        noon: slowString(20),
        evening: slowString(1),
      }),
      title: slowString(1),
    });

    const result = await v.validate(schema, {
      title: "t",
      meals: { evening: "e", noon: "n", morning: "m" },
    });

    expect(result.isValid).toBe(true);
    expect(Object.keys(result.data)).toEqual(["meals", "title"]);
    expect(Object.keys(result.data.meals)).toEqual(["morning", "noon", "evening"]);
  });

  it("orders objects inside arrays", async () => {
    const schema = v.array(v.object({ a: slowString(30), b: slowString(1) }));

    const result = await v.validate(schema, [{ b: "2", a: "1" }]);

    expect(result.isValid).toBe(true);
    expect(Object.keys(result.data[0])).toEqual(["a", "b"]);
  });

  it("puts declared keys first, then unknown keys in input order, with allowUnknown", async () => {
    const schema = v
      .object({
        first: slowString(40),
        second: slowString(1),
      })
      .allowUnknown();

    const result = await v.validate(schema, {
      zeta: 1,
      second: "2",
      alpha: 2,
      first: "1",
    });

    expect(result.isValid).toBe(true);
    expect(Object.keys(result.data)).toEqual(["first", "second", "zeta", "alpha"]);
  });

  it("keeps omitted fields out and still orders the remaining ones", async () => {
    const schema = v.object({
      a: slowString(30),
      b: v.string().optional(),
      c: slowString(1),
    });

    const result = await v.validate(schema, { c: "3", a: "1" });

    expect(result.isValid).toBe(true);
    expect(Object.keys(result.data)).toEqual(["a", "c"]);
  });

  it("reports errors in declared order regardless of completion order", async () => {
    const schema = v.object({
      first: slowFailing(40, "first failed"),
      second: slowFailing(20, "second failed"),
      third: slowFailing(1, "third failed"),
    });

    const result = await v.validate(schema, { first: "a", second: "b", third: "c" });

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.input)).toEqual(["first", "second", "third"]);
  });
});
