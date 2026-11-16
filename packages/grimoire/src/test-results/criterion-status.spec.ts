import { describe, expect, it } from "vitest";
import { criterionStatus } from "./criterion-status";

describe("criterionStatus", () => {
  it("orders fail, stale, not-run, pass", () => {
    expect(criterionStatus([])).toBe("no-test");
    expect(criterionStatus([{ result: "pass", stale: false }])).toBe("pass");
    expect(criterionStatus([{ result: "pass", stale: true }, { result: "fail", stale: false }])).toBe("fail");
    expect(criterionStatus([{ result: "pass", stale: true }, { result: "not-run", stale: false }])).toBe("stale");
    expect(criterionStatus([{ result: "pass", stale: false }, { result: "skip", stale: false }])).toBe("not-run");
  });
});
