import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DependencyGraph } from "../../../src/dev-server/dependency-graph";
import type { FileManager } from "../../../src/dev-server/file-manager";

/**
 * `DependencyGraph.build()` only reads `dependencies` and
 * `typeOnlyDependencies` off each FileManager, so a tiny stub stands in for
 * the full class without dragging in file I/O or the parser.
 */
function fakeFile(dependencies: string[], typeOnly: string[] = []): FileManager {
  return {
    dependencies: new Set(dependencies),
    typeOnlyDependencies: new Set(typeOnly),
  } as unknown as FileManager;
}

function filesMap(entries: Record<string, FileManager>): Map<string, FileManager> {
  return new Map(Object.entries(entries));
}

describe("DependencyGraph — edges", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it("records a forward dependency and its reverse dependent", () => {
    graph.addDependency("a.ts", "b.ts");

    expect(graph.getDependencies("a.ts")).toEqual(new Set(["b.ts"]));
    expect(graph.getDependents("b.ts")).toEqual(new Set(["a.ts"]));
  });

  it("returns an empty set for an unknown file's dependencies", () => {
    expect(graph.getDependencies("missing.ts")).toEqual(new Set());
  });

  it("returns an empty set for an unknown file's dependents", () => {
    expect(graph.getDependents("missing.ts")).toEqual(new Set());
  });

  it("defaults a new edge to runtime (not type-only)", () => {
    graph.addDependency("a.ts", "b.ts");

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(false);
  });

  it("keeps an edge type-only only while every reference is type-only", () => {
    graph.addDependency("a.ts", "b.ts", true);

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(true);
  });

  it("downgrades a type-only edge to runtime once a runtime reference appears", () => {
    graph.addDependency("a.ts", "b.ts", true);
    graph.addDependency("a.ts", "b.ts", false);

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(false);
  });

  it("never re-upgrades a runtime edge back to type-only", () => {
    graph.addDependency("a.ts", "b.ts", false);
    graph.addDependency("a.ts", "b.ts", true);

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(false);
  });

  it("reports false for a non-existent edge's type-only flag", () => {
    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(false);
  });
});

describe("DependencyGraph — removal", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it("removeDependency drops both directions of one edge", () => {
    graph.addDependency("a.ts", "b.ts");
    graph.removeDependency("a.ts", "b.ts");

    expect(graph.getDependencies("a.ts").has("b.ts")).toBe(false);
    expect(graph.getDependents("b.ts").has("a.ts")).toBe(false);
  });

  it("removeFile detaches the file from its dependencies and dependents", () => {
    graph.addDependency("a.ts", "b.ts");
    graph.addDependency("c.ts", "a.ts");

    graph.removeFile("a.ts");

    expect(graph.getDependents("b.ts").has("a.ts")).toBe(false);
    expect(graph.getDependencies("c.ts").has("a.ts")).toBe(false);
    expect(graph.getDependencies("a.ts")).toEqual(new Set());
  });
});

describe("DependencyGraph — updateFile", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it("adds new edges and removes ones no longer present", () => {
    graph.addDependency("a.ts", "old.ts");

    graph.updateFile("a.ts", new Set(["new.ts"]));

    expect(graph.getDependencies("a.ts")).toEqual(new Set(["new.ts"]));
    expect(graph.getDependents("old.ts").has("a.ts")).toBe(false);
  });

  it("applies the type-only flag for the supplied subset", () => {
    graph.updateFile("a.ts", new Set(["b.ts", "c.ts"]), new Set(["b.ts"]));

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(true);
    expect(graph.isEdgeTypeOnly("a.ts", "c.ts")).toBe(false);
  });

  it("flips an existing edge's type-only flag to match the new set", () => {
    graph.addDependency("a.ts", "b.ts", false);

    graph.updateFile("a.ts", new Set(["b.ts"]), new Set(["b.ts"]));

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(true);
  });
});

describe("DependencyGraph — invalidation chain", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it("includes the changed file itself", () => {
    expect(graph.getInvalidationChain("a.ts")).toEqual(["a.ts"]);
  });

  it("includes direct and transitive dependents", () => {
    // c imports b, b imports a → changing a must reload b then c.
    graph.addDependency("b.ts", "a.ts");
    graph.addDependency("c.ts", "b.ts");

    const chain = graph.getInvalidationChain("a.ts");

    expect(chain).toContain("a.ts");
    expect(chain).toContain("b.ts");
    expect(chain).toContain("c.ts");
  });

  it("does not loop forever on a cyclic dependent graph", () => {
    graph.addDependency("a.ts", "b.ts");
    graph.addDependency("b.ts", "a.ts");

    const chain = graph.getInvalidationChain("a.ts");

    expect(new Set(chain)).toEqual(new Set(["a.ts", "b.ts"]));
  });
});

describe("DependencyGraph — cycle detection", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it("finds a simple runtime two-file cycle", () => {
    graph.addDependency("a.ts", "b.ts");
    graph.addDependency("b.ts", "a.ts");

    const cycles = graph.detectCircularDependencies();

    expect(cycles.length).toBeGreaterThan(0);
  });

  it("suppresses a cycle that has a type-only edge", () => {
    graph.addDependency("a.ts", "b.ts", true);
    graph.addDependency("b.ts", "a.ts", false);

    expect(graph.detectCircularDependencies()).toEqual([]);
  });

  it("reports no cycle for an acyclic chain", () => {
    graph.addDependency("a.ts", "b.ts");
    graph.addDependency("b.ts", "c.ts");

    expect(graph.detectCircularDependencies()).toEqual([]);
  });
});

describe("DependencyGraph — build", () => {
  let graph: DependencyGraph;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    graph = new DependencyGraph();
    // build() prints a formatted warning when it finds a runtime cycle.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("constructs forward and reverse edges from FileManager metadata", () => {
    graph.build(
      filesMap({
        "a.ts": fakeFile(["b.ts"]),
        "b.ts": fakeFile([]),
      }),
    );

    expect(graph.getDependencies("a.ts")).toEqual(new Set(["b.ts"]));
    expect(graph.getDependents("b.ts")).toEqual(new Set(["a.ts"]));
  });

  it("marks edges listed in typeOnlyDependencies as type-only", () => {
    graph.build(
      filesMap({
        "a.ts": fakeFile(["b.ts"], ["b.ts"]),
        "b.ts": fakeFile([]),
      }),
    );

    expect(graph.isEdgeTypeOnly("a.ts", "b.ts")).toBe(true);
  });

  it("clears prior state on rebuild", () => {
    graph.build(filesMap({ "a.ts": fakeFile(["b.ts"]), "b.ts": fakeFile([]) }));
    graph.build(filesMap({ "x.ts": fakeFile([]) }));

    expect(graph.getDependencies("a.ts")).toEqual(new Set());
    expect(graph.getStats().totalFiles).toBe(1);
  });

  it("warns once for a runtime cycle discovered during build", () => {
    graph.build(
      filesMap({
        "a.ts": fakeFile(["b.ts"]),
        "b.ts": fakeFile(["a.ts"]),
      }),
    );

    expect(logSpy).toHaveBeenCalled();
  });

  it("stays silent when the only cycle is type-only", () => {
    graph.build(
      filesMap({
        "a.ts": fakeFile(["b.ts"], ["b.ts"]),
        "b.ts": fakeFile(["a.ts"]),
      }),
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("DependencyGraph — stats", () => {
  it("aggregates totals, maxes, and the most-connected files", () => {
    const graph = new DependencyGraph();

    graph.addDependency("a.ts", "shared.ts");
    graph.addDependency("a.ts", "b.ts");
    graph.addDependency("c.ts", "shared.ts");

    const stats = graph.getStats();

    expect(stats.maxDependencies).toBe(2);
    expect(stats.mostDependingFile).toBe("a.ts");
    expect(stats.maxDependents).toBe(2);
    expect(stats.mostDependedFile).toBe("shared.ts");
    expect(stats.totalDependencies).toBe(3);
  });

  it("reports zero averages for an empty graph", () => {
    const stats = new DependencyGraph().getStats();

    expect(stats.totalFiles).toBe(0);
    expect(stats.avgDependenciesPerFile).toBe(0);
  });
});
