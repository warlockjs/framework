import { beforeEach, describe, expect, it } from "vitest";
import type { FileManager } from "../../../src/dev-server/file-manager";
import { SpecialFilesCollector } from "../../../src/dev-server/special-files-collector";

/**
 * The collector only ever reads `relativePath` off a FileManager, so a thin
 * stub keeps these tests focused on the categorisation regexes.
 */
function fakeFile(relativePath: string): FileManager {
  return { relativePath } as unknown as FileManager;
}

function collectorWith(...paths: string[]): SpecialFilesCollector {
  const collector = new SpecialFilesCollector();

  collector.collect(new Map(paths.map((relativePath) => [relativePath, fakeFile(relativePath)])));

  return collector;
}

describe("SpecialFilesCollector — categorisation", () => {
  it("buckets config files under src/config", () => {
    const collector = collectorWith("src/config/database.ts");

    expect(collector.getFileType("src/config/database.ts")).toBe("config");
  });

  it("buckets a per-app main file", () => {
    const collector = collectorWith("src/app/store/main.ts");

    expect(collector.getFileType("src/app/store/main.ts")).toBe("main");
  });

  it("buckets the top-level src/app/main.ts as main", () => {
    const collector = collectorWith("src/app/main.ts");

    expect(collector.getFileType("src/app/main.ts")).toBe("main");
  });

  it("buckets a routes file", () => {
    const collector = collectorWith("src/app/store/routes.ts");

    expect(collector.getFileType("src/app/store/routes.ts")).toBe("route");
  });

  it("buckets a file under an events folder", () => {
    const collector = collectorWith("src/app/store/events/on-order.ts");

    expect(collector.getFileType("src/app/store/events/on-order.ts")).toBe("event");
  });

  it("buckets a locales file under utils", () => {
    const collector = collectorWith("src/app/store/utils/locales.ts");

    expect(collector.getFileType("src/app/store/utils/locales.ts")).toBe("locale");
  });

  it("does not categorise an ordinary service file", () => {
    const collector = collectorWith("src/app/store/services/checkout.service.ts");

    expect(collector.getFileType("src/app/store/services/checkout.service.ts")).toBeNull();
  });

  it("does not treat a nested routes-named file as a route", () => {
    // The route regex anchors at src/app/<unit>/routes.ts — deeper nesting misses.
    const collector = collectorWith("src/app/store/admin/routes.ts");

    expect(collector.getFileType("src/app/store/admin/routes.ts")).toBeNull();
  });
});

describe("SpecialFilesCollector — accessors", () => {
  let collector: SpecialFilesCollector;

  beforeEach(() => {
    collector = collectorWith(
      "src/config/app.ts",
      "src/app/store/routes.ts",
      "src/app/blog/routes.ts",
      "src/app/store/events/on-order.ts",
    );
  });

  it("returns route files sorted alphabetically for deterministic registration", () => {
    const routes = collector.getFilesByType("route").map((file) => file.relativePath);

    expect(routes).toEqual(["src/app/blog/routes.ts", "src/app/store/routes.ts"]);
  });

  it("reports per-type counts in getStats", () => {
    expect(collector.getStats()).toEqual({
      config: 1,
      main: 0,
      route: 2,
      event: 1,
      locale: 0,
    });
  });

  it("returns an empty array for a type with no files", () => {
    expect(collector.getFilesByType("locale")).toEqual([]);
  });
});

describe("SpecialFilesCollector — mutation", () => {
  let collector: SpecialFilesCollector;

  beforeEach(() => {
    collector = new SpecialFilesCollector();
  });

  it("addFile categorises a single file", () => {
    collector.addFile(fakeFile("src/config/cache.ts"));

    expect(collector.getFileType("src/config/cache.ts")).toBe("config");
  });

  it("removeFile drops a file from its bucket", () => {
    collector.addFile(fakeFile("src/app/store/routes.ts"));
    collector.removeFile("src/app/store/routes.ts");

    expect(collector.getFileType("src/app/store/routes.ts")).toBeNull();
  });

  it("clear empties every bucket", () => {
    collector.addFile(fakeFile("src/config/app.ts"));
    collector.addFile(fakeFile("src/app/store/routes.ts"));

    collector.clear();

    expect(collector.getStats()).toEqual({
      config: 0,
      main: 0,
      route: 0,
      event: 0,
      locale: 0,
    });
  });

  it("updateFile re-categorises after a path no longer qualifies", () => {
    collector.addFile(fakeFile("src/config/app.ts"));

    // Same FileManager identity, but its path now points outside src/config.
    collector.removeFile("src/config/app.ts");
    collector.updateFile(fakeFile("src/app/store/services/app.service.ts"));

    expect(collector.getFileType("src/config/app.ts")).toBeNull();
    expect(collector.getFileType("src/app/store/services/app.service.ts")).toBeNull();
  });
});
