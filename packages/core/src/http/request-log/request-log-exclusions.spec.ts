import { describe, expect, it } from "vitest";
import { excludeFromRequestLog, isExcludedFromRequestLog } from "./request-log-exclusions";

describe("request log exclusions", () => {
  it("matches the prefix and its children, not a partial segment", () => {
    const remove = excludeFromRequestLog("/ops");

    expect(isExcludedFromRequestLog("/ops")).toBe(true);
    expect(isExcludedFromRequestLog("/ops/api/auth/login")).toBe(true);
    expect(isExcludedFromRequestLog("/opsx")).toBe(false);
    expect(isExcludedFromRequestLog("/other")).toBe(false);

    remove();

    expect(isExcludedFromRequestLog("/ops")).toBe(false);
  });

  it("keeps a rule until every registration is removed", () => {
    const first = excludeFromRequestLog("/ops/");
    const second = excludeFromRequestLog("/ops");

    first();
    first();

    expect(isExcludedFromRequestLog("/ops/x")).toBe(true);

    second();

    expect(isExcludedFromRequestLog("/ops/x")).toBe(false);
  });

  it("never excludes everything", () => {
    const remove = excludeFromRequestLog("/");

    expect(isExcludedFromRequestLog("/anything")).toBe(false);

    remove();
  });
});
