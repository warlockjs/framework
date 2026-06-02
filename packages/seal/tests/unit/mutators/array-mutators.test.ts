import { describe, expect, it } from "vitest";
import {
  flipArrayMutator,
  removeEmptyArrayElementsMutator,
  reverseArrayMutator,
  sortArrayMutator,
  uniqueArrayMutator,
} from "../../../src/mutators/array-mutators";

describe("Array Mutators", () => {
  it("flip", async () => {
    expect(await flipArrayMutator([1, 2, 3])).toEqual([3, 2, 1]);
    expect(await flipArrayMutator(["a", "b", "c"])).toEqual(["c", "b", "a"]);
  });

  it("reverse", async () => {
    expect(await reverseArrayMutator([1, 2, 3])).toEqual([3, 2, 1]);
    expect(await reverseArrayMutator(["a", "b", "c"])).toEqual(["c", "b", "a"]);
  });

  it("sort ascending", async () => {
    const context = { options: { direction: "asc" } } as any;
    expect(await sortArrayMutator([3, 1, 2], context)).toEqual([1, 2, 3]);
  });

  it("sort descending", async () => {
    const context = { options: { direction: "desc" } } as any;
    expect(await sortArrayMutator([1, 3, 2], context)).toEqual([3, 2, 1]);
  });

  it("sort by key ascending", async () => {
    const context = { options: { direction: "asc", key: "age" } } as any;
    const input = [{ age: 30 }, { age: 20 }, { age: 25 }];
    expect(await sortArrayMutator(input, context)).toEqual([{ age: 20 }, { age: 25 }, { age: 30 }]);
  });

  it("sort by key descending", async () => {
    const context = { options: { direction: "desc", key: "age" } } as any;
    const input = [{ age: 20 }, { age: 30 }, { age: 25 }];
    expect(await sortArrayMutator(input, context)).toEqual([{ age: 30 }, { age: 25 }, { age: 20 }]);
  });

  it("unique", async () => {
    expect(await uniqueArrayMutator([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    expect(await uniqueArrayMutator(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("removeEmpty", async () => {
    expect(await removeEmptyArrayElementsMutator([1, null, 2, undefined, 3, ""])).toEqual([
      1, 2, 3,
    ]);
    expect(await removeEmptyArrayElementsMutator(["a", "", "b", null])).toEqual(["a", "b"]);
  });
});
