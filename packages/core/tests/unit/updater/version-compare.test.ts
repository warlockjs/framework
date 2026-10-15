import { describe, expect, it } from "vitest";
import { isNewerVersion } from "../../../src/utils/version-compare";

describe("isNewerVersion", () => {
  it("detects a newer patch, minor, or major", () => {
    expect(isNewerVersion("4.2.12", "4.2.11")).toBe(true);
    expect(isNewerVersion("4.3.0", "4.2.11")).toBe(true);
    expect(isNewerVersion("5.0.0", "4.9.9")).toBe(true);
  });

  it("returns false for equal or older versions", () => {
    expect(isNewerVersion("4.2.11", "4.2.11")).toBe(false);
    expect(isNewerVersion("4.2.10", "4.2.11")).toBe(false);
    expect(isNewerVersion("3.9.9", "4.0.0")).toBe(false);
  });

  it("tolerates a leading v and ignores build metadata", () => {
    expect(isNewerVersion("v4.3.0", "4.2.11")).toBe(true);
    expect(isNewerVersion("4.3.0+build.5", "4.3.0")).toBe(false);
  });

  it("orders a stable release above its prereleases", () => {
    expect(isNewerVersion("4.3.0", "4.3.0-beta.1")).toBe(true);
    expect(isNewerVersion("4.3.0-beta.1", "4.3.0")).toBe(false);
    expect(isNewerVersion("4.3.0-beta.2", "4.3.0-beta.1")).toBe(true);
    expect(isNewerVersion("4.3.0-beta.1", "4.3.0-alpha.9")).toBe(true);
  });

  it("returns false on unparseable input", () => {
    expect(isNewerVersion("not-a-version", "4.2.11")).toBe(false);
    expect(isNewerVersion("4.3", "4.2.11")).toBe(false);
    expect(isNewerVersion("", "4.2.11")).toBe(false);
  });
});
