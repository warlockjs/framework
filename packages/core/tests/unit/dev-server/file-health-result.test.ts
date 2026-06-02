import { describe, expect, it } from "vitest";
import { FileHealthResult } from "../../../src/dev-server/health-checker/file-health-result";

/**
 * FileHealthResult is the per-file verdict a checker fills in. It starts
 * healthy and flips to defective the moment any error or warning is added.
 */
describe("FileHealthResult", () => {
  it("defaults to healthy with no messages", () => {
    const result = new FileHealthResult();

    expect(result.result).toBe("healthy");
    expect(result.getStats()).toEqual({ state: "healthy", errors: 0, warnings: 0 });
  });

  it("flips to defective and counts errors", () => {
    const result = new FileHealthResult();

    result.addErrors([
      { message: "boom", type: "error", lineNumber: 3, columnNumber: 1 },
      { message: "bang", type: "error", lineNumber: 7, columnNumber: 2 },
    ]);

    const stats = result.getStats();

    expect(stats.state).toBe("defective");
    expect(stats.errors).toBe(2);
    expect(stats.warnings).toBe(0);
  });

  it("flips to defective and counts warnings", () => {
    const result = new FileHealthResult();

    result.addWarnings([
      { message: "careful", type: "warning", lineNumber: 1, columnNumber: 1 },
    ]);

    const stats = result.getStats();

    expect(stats.state).toBe("defective");
    expect(stats.warnings).toBe(1);
    expect(stats.errors).toBe(0);
  });

  it("counts errors and warnings separately by message type", () => {
    const result = new FileHealthResult();

    result.addErrors([{ message: "e", type: "error", lineNumber: 1, columnNumber: 1 }]);
    result.addWarnings([
      { message: "w1", type: "warning", lineNumber: 2, columnNumber: 1 },
      { message: "w2", type: "warning", lineNumber: 3, columnNumber: 1 },
    ]);

    expect(result.getStats()).toEqual({ state: "defective", errors: 1, warnings: 2 });
  });

  it("markAsHealthy resets the verdict but keeps recorded messages", () => {
    const result = new FileHealthResult();

    result.addErrors([{ message: "e", type: "error", lineNumber: 1, columnNumber: 1 }]);
    result.markAsHealthy();

    expect(result.result).toBe("healthy");
    expect(result.messages).toHaveLength(1);
  });
});
