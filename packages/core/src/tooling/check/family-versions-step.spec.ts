import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFamilyVersions, listInstalledFamilyPackages } from "./family-versions-step";

let root: string;

function install(name: string, version: string, base = root): void {
  const dir = path.join(base, "node_modules", "@warlock.js", name);

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `@warlock.js/${name}`, version }),
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-family-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkFamilyVersions", () => {
  it("reports nothing when no @warlock.js package is installed", () => {
    expect(checkFamilyVersions(root)).toEqual([]);
  });

  it("reports nothing when every package shares one version", () => {
    install("core", "5.37.1");
    install("auth", "5.37.1");

    expect(checkFamilyVersions(root)).toEqual([]);
  });

  it("names the packages that differ from the newest installed version", () => {
    install("core", "5.37.1");
    install("auth", "5.37.0");
    install("access", "5.36.0");

    const [problem, ...rest] = checkFamilyVersions(root);

    expect(rest).toEqual([]);
    expect(problem?.code).toBe("WL8010");
    expect(problem?.category).toBe("environment");
    expect(problem?.message).toContain("@warlock.js/access@5.36.0");
    expect(problem?.message).toContain("@warlock.js/auth@5.37.0");
    expect(problem?.message).not.toContain("@warlock.js/core@");
    expect(problem?.message).toContain("5.37.1");
    expect(problem?.message).toContain("warlock update");
  });

  it("compares versions numerically, not as text", () => {
    install("core", "5.100.0");
    install("auth", "5.9.0");

    expect(checkFamilyVersions(root)[0]?.message).toContain("@warlock.js/auth@5.9.0");
  });

  it("finds a hoisted install in a parent directory", () => {
    install("core", "5.37.1");
    install("auth", "5.37.0");
    const app = path.join(root, "apps", "web");
    mkdirSync(app, { recursive: true });

    expect(checkFamilyVersions(app)).toHaveLength(1);
    expect(listInstalledFamilyPackages(app).map((entry) => entry.name)).toEqual([
      "@warlock.js/auth",
      "@warlock.js/core",
    ]);
  });
});
