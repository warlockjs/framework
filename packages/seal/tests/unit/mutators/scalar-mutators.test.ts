import { describe, expect, it } from "vitest";
import { stringMutator } from "../../../src/mutators/scalar-mutators";

describe("Scalar Mutators", () => {
  it("string from number", async () => {
    expect(await stringMutator(123)).toBe("123");
  });

  it("string from boolean", async () => {
    expect(await stringMutator(true)).toBe("true");
    expect(await stringMutator(false)).toBe("false");
  });

  it("string from string", async () => {
    expect(await stringMutator("hello")).toBe("hello");
  });

  it("string from null/undefined", async () => {
    expect(await stringMutator(null)).toBe(null);
    expect(await stringMutator(undefined)).toBe(undefined);
  });

  it("string from empty string", async () => {
    expect(await stringMutator("")).toBe("");
  });
});
