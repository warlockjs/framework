import { describe, expect, it } from "vitest";
import {
  MIN_NPM_VERSION,
  oldNpmMessage,
  parseNpmVersion,
  pruneFamilyLockEntries,
} from "./prune-npm-lockfile";

describe("pruneFamilyLockEntries", () => {
  it("removes the family, vite and vitest entries, nested copies included", () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "@warlock.js/core": "^5.37.1" } },
        "node_modules/@warlock.js/core": { version: "5.35.0" },
        "node_modules/@warlock.js/access": { version: "5.35.0" },
        "node_modules/vite": { version: "7.0.0" },
        "node_modules/vitest": { version: "4.0.0" },
        "node_modules/@vitest/runner": { version: "4.0.0" },
        "node_modules/@vitejs/plugin-react": { version: "5.0.0" },
        "node_modules/foo/node_modules/@warlock.js/seal": { version: "5.35.0" },
        "node_modules/vitest-fetch-mock": { version: "1.0.0" },
        "node_modules/react": { version: "19.0.0" },
      },
    };

    const removed = pruneFamilyLockEntries(lockfile);

    expect(removed).toEqual([
      "@vitejs/plugin-react",
      "@vitest/runner",
      "@warlock.js/access",
      "@warlock.js/core",
      "@warlock.js/seal",
      "vite",
      "vitest",
    ]);
    expect(Object.keys(lockfile.packages)).toEqual([
      "",
      "node_modules/vitest-fetch-mock",
      "node_modules/react",
    ]);
  });

  it("prunes the nested dependencies tree of an older lockfile", () => {
    const lockfile = {
      dependencies: {
        "@warlock.js/core": { version: "5.35.0" },
        foo: { version: "1.0.0", dependencies: { vite: { version: "6.0.0" } } },
      },
    };

    expect(pruneFamilyLockEntries(lockfile)).toEqual(["@warlock.js/core", "vite"]);
    expect(lockfile.dependencies).toEqual({ foo: { version: "1.0.0", dependencies: {} } });
  });

  it("removes nothing from a lockfile without those packages", () => {
    const lockfile = { packages: { "": {}, "node_modules/react": { version: "19.0.0" } } };

    expect(pruneFamilyLockEntries(lockfile)).toEqual([]);
  });
});

describe("npm version helpers", () => {
  it("reads the version from npm --version output", () => {
    expect(parseNpmVersion("10.9.2\n")).toBe("10.9.2");
    expect(parseNpmVersion("not a version")).toBeUndefined();
  });

  it("names the minimum npm in the warning", () => {
    expect(oldNpmMessage("10.9.2")).toContain(`npm ${MIN_NPM_VERSION} or newer`);
    expect(oldNpmMessage("10.9.2")).toContain("npm 10.9.2");
  });
});
