import { describe, expect, it } from "vitest";
import { normalizeRequestPath } from "../../../src/router/normalize-request-path";

describe("normalizeRequestPath", () => {
  it("removes one trailing slash from a non-root pathname", () => {
    expect(normalizeRequestPath("/about/")).toBe("/about");
  });

  it("preserves root instead of normalizing it to an empty string", () => {
    expect(normalizeRequestPath("/")).toBe("/");
    expect(normalizeRequestPath("")).toBe("/");
  });

  it("preserves case and every non-terminal slash", () => {
    expect(normalizeRequestPath("/About/")).toBe("/About");
    expect(normalizeRequestPath("/docs//intro")).toBe("/docs//intro");
  });
});
