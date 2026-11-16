import { describe, expect, it } from "vitest";
import { fileGraph, importClosure, importerClosure, packageNameOf } from "./index";

const graph = fileGraph([
  {
    file: "a.ts",
    imports: [
      { specifier: "./b", file: "b.ts" },
      { specifier: "dayjs", file: null },
    ],
    importedBy: [],
  },
  { file: "b.ts", imports: [{ specifier: "./c", file: "c.ts" }], importedBy: ["a.ts", "c.ts"] },
  { file: "c.ts", imports: [{ specifier: "./b", file: "b.ts" }], importedBy: ["b.ts"] },
  { file: "d.ts", imports: [], importedBy: [] },
]);

describe("import graph", () => {
  it("walks imports and importers through cycles", () => {
    expect(importClosure(graph, ["a.ts"])).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(importerClosure(graph, ["c.ts"])).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(importClosure(graph, ["missing.ts"])).toEqual([]);
  });

  it("reads package names", () => {
    expect(packageNameOf("@warlock.js/core/tooling")).toBe("@warlock.js/core");
    expect(packageNameOf("dayjs/plugin/utc")).toBe("dayjs");
    expect(packageNameOf("./x")).toBeNull();
    expect(packageNameOf("node:path")).toBeNull();
  });
});
