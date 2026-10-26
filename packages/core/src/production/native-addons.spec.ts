import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearNativePackageCache,
  isNativePackage,
  matchesPlatform,
  stageNativePackages,
} from "./native-addons";

let root: string;

function pkg(name: string, manifest: object, files: Record<string, string> = {}): string {
  const directory = path.join(root, "node_modules", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
  );

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), content);
  }

  return directory;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-native-"));
  clearNativePackageCache();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("matchesPlatform", () => {
  const linux = { os: "linux", cpu: "x64", libc: "glibc" as const };

  it("allows a package with no platform fields", () => {
    expect(matchesPlatform({}, linux)).toBe(true);
  });

  it("matches os, cpu and libc", () => {
    expect(matchesPlatform({ os: ["linux"], cpu: ["x64"], libc: ["glibc"] }, linux)).toBe(true);
    expect(matchesPlatform({ os: ["win32"] }, linux)).toBe(false);
    expect(matchesPlatform({ cpu: ["arm64"] }, linux)).toBe(false);
    expect(matchesPlatform({ libc: ["musl"] }, linux)).toBe(false);
  });

  it("honours negated entries", () => {
    expect(matchesPlatform({ os: ["!linux"] }, linux)).toBe(false);
    expect(matchesPlatform({ os: ["!win32"] }, linux)).toBe(true);
  });
});

describe("isNativePackage", () => {
  it("is true for a package holding a .node file", () => {
    const directory = pkg("has-binary", {}, { "build/Release/x.node": "bin" });

    expect(isNativePackage(directory)).toBe(true);
  });

  it("is true for a napi-style loader whose platform package holds the binary", () => {
    const loader = pkg(
      "napi-loader",
      { optionalDependencies: { "napi-loader-linux-x64": "1.0.0" } },
      { "index.js": "" },
    );
    pkg(
      "napi-loader-linux-x64",
      { os: ["linux"], cpu: ["x64"] },
      { "loader.linux-x64.node": "bin" },
    );

    expect(isNativePackage(loader)).toBe(true);
  });

  it("is false for plain JavaScript, and ignores nested node_modules", () => {
    const directory = pkg("plain", {}, { "index.js": "", "node_modules/inner/x.node": "bin" });

    expect(isNativePackage(directory)).toBe(false);
  });
});

describe("stageNativePackages", () => {
  it("copies only what is needed to load, plus the dependencies it loads", async () => {
    const main = pkg(
      "stage-me",
      {
        dependencies: { "stage-helper": "1.0.0" },
        optionalDependencies: { "stage-me-other-os": "1.0.0", "stage-me-here": "1.0.0" },
      },
      {
        "index.js": "module.exports = 1",
        "README.md": "docs",
        "index.d.ts": "types",
        "src/addon.cc": "source",
        "test/spec.js": "test",
      },
    );
    pkg("stage-helper", {}, { "index.js": "module.exports = 2" });
    pkg("stage-me-other-os", { os: ["plan9"] }, { "x.node": "bin" });
    pkg("stage-me-here", { os: [process.platform], cpu: [process.arch] }, { "x.node": "bin" });

    const dist = path.join(root, "dist");
    const result = await stageNativePackages(dist, [{ name: "stage-me", directory: main }]);

    expect(result.staged.sort()).toEqual(["stage-helper", "stage-me", "stage-me-here"]);
    expect(result.missing).toEqual([]);

    const staged = (relative: string) => existsSync(path.join(dist, "node_modules", relative));

    expect(staged("stage-me/package.json")).toBe(true);
    expect(staged("stage-me/index.js")).toBe(true);
    expect(staged("stage-me/README.md")).toBe(false);
    expect(staged("stage-me/index.d.ts")).toBe(false);
    expect(staged("stage-me/src/addon.cc")).toBe(false);
    expect(staged("stage-me/test/spec.js")).toBe(false);
    expect(staged("stage-helper/index.js")).toBe(true);
    expect(staged("stage-me-here/x.node")).toBe(true);
    expect(staged("stage-me-other-os")).toBe(false);
  });

  it("stages under the requested name and reports a package this platform cannot use", async () => {
    const aliased = pkg("real-name", {}, { "index.js": "", "a.node": "bin" });
    const foreign = pkg("foreign", { os: ["plan9"] }, { "x.node": "bin" });
    const dist = path.join(root, "dist3");
    const result = await stageNativePackages(dist, [
      { name: "alias-name", directory: aliased },
      { name: "foreign", directory: foreign },
    ]);

    expect(result.staged).toEqual(["alias-name"]);
    expect(result.skipped).toEqual(["foreign"]);
    expect(existsSync(path.join(dist, "node_modules", "alias-name", "a.node"))).toBe(true);
    expect(existsSync(path.join(dist, "node_modules", "real-name"))).toBe(false);
  });

  it("reports a required dependency it cannot find", async () => {
    const main = pkg("lonely", { dependencies: { "ghost-dep": "1.0.0" } }, { "index.js": "" });
    const result = await stageNativePackages(path.join(root, "dist2"), [
      { name: "lonely", directory: main },
    ]);

    expect(result.missing).toEqual(["ghost-dep"]);
  });
});
