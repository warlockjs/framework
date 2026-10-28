import { describe, expect, it } from "vitest";
import * as ast from "./ast";
import { importSpecifiers } from "./imports";

describe("parseSourceFile", () => {
  it("finds the parent and the source of a node without enumerable links", () => {
    const source = ast.parseSourceFile("a.ts", 'import { a } from "./a";\nexport const b = a;\n');
    const declaration = source.body[0];

    expect(declaration && ast.parentOf(declaration)).toBe(source);
    expect(declaration && ast.sourceOf(declaration)).toBe(source);
    // Parent links must not show up when a node is copied or serialised.
    expect(() => JSON.stringify(source)).not.toThrow();
    expect(Object.keys(declaration ?? {})).not.toContain("parent");
  });

  it("does not slow down as parsed trees accumulate", () => {
    const body = Array.from(
      { length: 300 },
      (_, index) => `export const v${index} = { a: [${index}, { b: ${index} }] };`,
    ).join("\n");
    const batch = (): number => {
      const startedAt = performance.now();

      for (let index = 0; index < 150; index++) ast.parseSourceFile(`f${index}.ts`, body);

      return performance.now() - startedAt;
    };
    const first = batch();

    for (let round = 0; round < 3; round++) batch();

    // Parent links used to live in WeakMaps, which made later batches pause in the collector.
    expect(batch()).toBeLessThan(Math.max(first * 6, 3000));
  });
});

describe("importSpecifiers", () => {
  it("reads imports from an already parsed file", () => {
    const source = ast.parseSourceFile("a.ts", 'import "./x";\nconst y = require("./y");\n');

    expect(importSpecifiers("a.ts", source).map((item) => item.specifier)).toEqual(["./x", "./y"]);
  });
});
