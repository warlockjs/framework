import { describe, expect, it } from "vitest";
import { resolvePackageUpdates } from "../../../src/updater/update-warlock-packages";

describe("resolvePackageUpdates", () => {
  it("preserves the caret range operator", () => {
    const updates = resolvePackageUpdates([
      { name: "@warlock.js/core", section: "dependencies", current: "^4.2.0", latest: "4.3.0" },
    ]);

    expect(updates).toEqual([
      { name: "@warlock.js/core", section: "dependencies", from: "^4.2.0", to: "^4.3.0" },
    ]);
  });

  it("preserves the tilde operator and exact pins", () => {
    const updates = resolvePackageUpdates([
      { name: "@warlock.js/cache", section: "dependencies", current: "~4.2.0", latest: "4.3.0" },
      { name: "@warlock.js/seal", section: "devDependencies", current: "4.2.0", latest: "4.3.0" },
    ]);

    expect(updates.map((update) => update.to)).toEqual(["~4.3.0", "4.3.0"]);
  });

  it("skips packages already at or ahead of latest", () => {
    const updates = resolvePackageUpdates([
      { name: "@warlock.js/core", section: "dependencies", current: "^4.3.0", latest: "4.3.0" },
      { name: "@warlock.js/cache", section: "dependencies", current: "^4.4.0", latest: "4.3.0" },
    ]);

    expect(updates).toEqual([]);
  });

  it("skips non-semver specs and failed lookups", () => {
    const updates = resolvePackageUpdates([
      {
        name: "@warlock.js/core",
        section: "dependencies",
        current: "workspace:*",
        latest: "4.3.0",
      },
      { name: "@warlock.js/cache", section: "dependencies", current: "*", latest: "4.3.0" },
      { name: "@warlock.js/seal", section: "dependencies", current: "^4.2.0", latest: undefined },
    ]);

    expect(updates).toEqual([]);
  });
});
