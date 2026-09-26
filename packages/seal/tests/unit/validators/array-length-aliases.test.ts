import { describe, expect, it } from "vitest";
import { validate, v } from "../../../src/index";

describe("ArrayValidator length aliases", () => {
  it("uses min and max as aliases for minLength and maxLength", async () => {
    const min = await validate(v.array(v.string()).min(2, "at least two"), ["one"]);
    const max = await validate(v.array(v.string()).max(1, "at most one"), ["one", "two"]);

    expect(min.errors[0]?.error).toBe("at least two");
    expect(max.errors[0]?.error).toBe("at most one");
  });

  it("keeps minLength and maxLength working", async () => {
    expect((await validate(v.array(v.string()).minLength(2), ["one"])).isValid).toBe(false);
    expect((await validate(v.array(v.string()).maxLength(1), ["one", "two"])).isValid).toBe(false);
  });

  it("supports an exact length", async () => {
    expect((await validate(v.array(v.string()).length(2), ["one", "two"])).isValid).toBe(true);
  });
});
