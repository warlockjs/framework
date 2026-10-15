import { beforeEach, describe, expect, it } from "vitest";
import type { FileManager } from "../../../src/dev-server/file-manager";
import { BaseHealthChecker } from "../../../src/dev-server/health-checker/checkers/base-health-checker";
import { FileHealthResult } from "../../../src/dev-server/health-checker/file-health-result";

/**
 * Concrete checker used to exercise the shared lifecycle that
 * `BaseHealthChecker` provides (file tracking, removal, stats aggregation).
 * Its `validate` is steered per-test via the injected verdict function.
 */
class TestHealthChecker extends BaseHealthChecker {
  public name = "Test";

  public constructor(
    private readonly verdict: (file: FileManager, result: FileHealthResult) => void = () => {},
  ) {
    super();
  }

  public initialize(): void {
    // no setup needed for the stub
  }

  public async validate(file: FileManager, result: FileHealthResult): Promise<FileHealthResult> {
    this.verdict(file, result);

    return result;
  }
}

function fakeFile(relativePath: string): FileManager {
  return { relativePath } as unknown as FileManager;
}

describe("BaseHealthChecker — check + tracking", () => {
  let checker: TestHealthChecker;

  beforeEach(() => {
    checker = new TestHealthChecker();
  });

  it("returns the result produced by validate", async () => {
    const result = await checker.check(fakeFile("a.ts"));

    expect(result).toBeInstanceOf(FileHealthResult);
    expect(result.result).toBe("healthy");
  });

  it("tracks the checked file so it counts toward stats", async () => {
    await checker.check(fakeFile("a.ts"));

    const stats = await checker.stats();

    expect(stats.name).toBe("Test");
    expect(stats.files.healthy).toBe(1);
  });

  it("removeFile stops the file counting toward stats", async () => {
    await checker.check(fakeFile("a.ts"));

    checker.removeFile(fakeFile("a.ts"));

    const stats = await checker.stats();

    expect(stats.files.healthy).toBe(0);
  });

  it("re-checking the same path replaces its prior verdict", async () => {
    const failing = new TestHealthChecker((_file, result) => {
      result.addErrors([{ message: "x", type: "error", lineNumber: 1, columnNumber: 1 }]);
    });

    await failing.check(fakeFile("a.ts"));
    await failing.check(fakeFile("a.ts"));

    const stats = await failing.stats();

    // One path tracked → one defective file, not two.
    expect(stats.files.defective).toBe(1);
  });
});

describe("BaseHealthChecker — stats aggregation", () => {
  it("aggregates healthy and defective files with error/warning totals", async () => {
    let mode: "ok" | "errors" | "warnings" = "ok";

    const checker = new TestHealthChecker((_file, result) => {
      if (mode === "errors") {
        result.addErrors([
          { message: "e1", type: "error", lineNumber: 1, columnNumber: 1 },
          { message: "e2", type: "error", lineNumber: 2, columnNumber: 1 },
        ]);
      } else if (mode === "warnings") {
        result.addWarnings([{ message: "w", type: "warning", lineNumber: 1, columnNumber: 1 }]);
      }
    });

    await checker.check(fakeFile("healthy.ts"));

    mode = "errors";
    await checker.check(fakeFile("broken.ts"));

    mode = "warnings";
    await checker.check(fakeFile("warned.ts"));

    const stats = await checker.stats();

    expect(stats.files.healthy).toBe(1);
    expect(stats.files.defective).toBe(2);
    expect(stats.errors.total).toBe(2);
    expect(stats.errors.totalFiles).toBe(1);
    expect(stats.warnings.total).toBe(1);
    expect(stats.warnings.totalFiles).toBe(1);
  });

  it("reports zeroed stats before any file is checked", async () => {
    const stats = await new TestHealthChecker().stats();

    expect(stats.files).toEqual({ healthy: 0, defective: 0 });
    expect(stats.errors).toEqual({ total: 0, totalFiles: 0 });
    expect(stats.warnings).toEqual({ total: 0, totalFiles: 0 });
  });
});
