import { beforeEach, describe, expect, it } from "vitest";
import { bumpVersion, getVersion } from "../../../src/dev-server/loader/version-registry";

/**
 * The version registry is a process-wide singleton Map, so each test uses a
 * unique path to stay isolated from neighbours. Paths not yet bumped read 0.
 */
let counter = 0;

function uniquePath(): string {
  return `/abs/path/to/file-${counter++}.ts`;
}

describe("version-registry", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = uniquePath();
  });

  it("returns 0 for a path that was never bumped", () => {
    expect(getVersion(filePath)).toBe(0);
  });

  it("starts at 1 after the first bump", () => {
    bumpVersion(filePath);

    expect(getVersion(filePath)).toBe(1);
  });

  it("increments monotonically on every bump", () => {
    bumpVersion(filePath);
    bumpVersion(filePath);
    bumpVersion(filePath);

    expect(getVersion(filePath)).toBe(3);
  });

  it("tracks each path independently", () => {
    const other = uniquePath();

    bumpVersion(filePath);
    bumpVersion(filePath);

    expect(getVersion(filePath)).toBe(2);
    expect(getVersion(other)).toBe(0);
  });

  it("treats backslash and forward-slash paths as the same key", () => {
    const forward = `/abs/key-${counter++}/user.model.ts`;
    const backslash = forward.replace(/\//g, "\\");

    bumpVersion(backslash);

    expect(getVersion(forward)).toBe(1);
  });

  it("is case-insensitive on the key", () => {
    const lower = `/abs/case-${counter++}/user.model.ts`;

    bumpVersion(lower);

    expect(getVersion(lower.toUpperCase())).toBe(1);
  });

  it("collapses mixed-separator + mixed-case writes onto one counter", () => {
    const base = `/abs/Mixed-${counter++}/User.Model.ts`;

    bumpVersion(base);
    bumpVersion(base.replace(/\//g, "\\").toUpperCase());

    expect(getVersion(base)).toBe(2);
  });
});
