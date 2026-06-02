import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ownResolve,
  probeFile,
  type FileExists,
} from "../../../src/dev-server/loader/own-resolver";

/**
 * Build a `fileExists` probe from a fixed allowlist of POSIX paths.
 */
function fsWith(...present: string[]): FileExists {
  const set = new Set(present);

  return (absolutePath: string) => set.has(absolutePath);
}

/**
 * Resolve `specifier` against `parentURL` exactly the way `ownResolve` does
 * (URL join → fileURLToPath → forward-slash) so the on-disk allowlist key and
 * the expected `file://` URL are derived identically on every OS.
 */
function diskPath(specifier: string, parentURL: string): string {
  return fileURLToPath(new URL(specifier, parentURL)).replace(/\\/g, "/");
}

describe("probeFile — precedence", () => {
  it("prefers the .ts source over a literal .js when a .js specifier is given", () => {
    expect(probeFile("/a/b.js", fsWith("/a/b.ts", "/a/b.js"))).toBe("/a/b.ts");
  });

  it("rewrites .mjs and .cjs specifiers to the .ts source", () => {
    expect(probeFile("/a/b.mjs", fsWith("/a/b.ts"))).toBe("/a/b.ts");
    expect(probeFile("/a/b.cjs", fsWith("/a/b.tsx"))).toBe("/a/b.tsx");
  });

  it("falls back to the literal .js when no .ts source exists", () => {
    expect(probeFile("/a/b.js", fsWith("/a/b.js"))).toBe("/a/b.js");
  });

  it("appends extensions in ts → tsx → js → jsx → json order", () => {
    expect(probeFile("/a/c", fsWith("/a/c.json"))).toBe("/a/c.json");
    expect(probeFile("/a/c", fsWith("/a/c.js", "/a/c.json"))).toBe("/a/c.js");
  });

  it("prefers an appended extension over a directory index", () => {
    expect(probeFile("/a/c", fsWith("/a/c.ts", "/a/c/index.ts"))).toBe("/a/c.ts");
  });

  it("resolves a directory index when no sibling file exists", () => {
    expect(probeFile("/a/dir", fsWith("/a/dir/index.tsx"))).toBe("/a/dir/index.tsx");
  });

  it("returns null when nothing matches", () => {
    expect(probeFile("/a/ghost", fsWith())).toBeNull();
  });
});

describe("ownResolve — passthrough specifiers", () => {
  const fileExists = fsWith();

  it("returns null for node: builtins", () => {
    expect(ownResolve("node:fs", "file:///proj/a.ts", null, fileExists)).toBeNull();
  });

  it("returns null for file: URLs", () => {
    expect(ownResolve("file:///proj/x.ts", undefined, null, fileExists)).toBeNull();
  });

  it("returns null for data: URLs", () => {
    expect(ownResolve("data:text/javascript,1", undefined, null, fileExists)).toBeNull();
  });

  it("returns null for a bare package with no paths matcher", () => {
    expect(ownResolve("lodash", "file:///proj/a.ts", null, fileExists)).toBeNull();
  });
});

describe("ownResolve — relative & absolute imports", () => {
  it("resolves a relative import against the parent URL", () => {
    const parent = pathToFileURL("/proj/src/app/a.ts").href;
    const target = `${diskPath("./b", parent)}.ts`;

    const resolved = ownResolve("./b", parent, null, fsWith(target));

    expect(resolved).toBe(pathToFileURL(target).href);
  });

  it("resolves a parent-directory import", () => {
    const parent = pathToFileURL("/proj/src/app/nested/a.ts").href;
    const target = `${diskPath("../shared", parent)}.ts`;

    const resolved = ownResolve("../shared", parent, null, fsWith(target));

    expect(resolved).toBe(pathToFileURL(target).href);
  });

  it("returns null for a relative import that resolves to nothing on disk", () => {
    const parent = pathToFileURL("/proj/src/app/a.ts").href;

    expect(ownResolve("./missing", parent, null, fsWith())).toBeNull();
  });

  it("returns null for a relative import with no parent URL", () => {
    expect(ownResolve("./b", undefined, null, fsWith("/proj/b.ts"))).toBeNull();
  });
});

describe("ownResolve — tsconfig paths aliases", () => {
  it("probes each alias candidate and returns the first that exists", () => {
    const matcher = (specifier: string) =>
      specifier === "app/users/user.model"
        ? ["/proj/src/app/users/user.model"]
        : [];
    const fileExists = fsWith("/proj/src/app/users/user.model.ts");

    const resolved = ownResolve("app/users/user.model", "file:///proj/a.ts", matcher, fileExists);

    expect(resolved).toBe(pathToFileURL("/proj/src/app/users/user.model.ts").href);
  });

  it("returns null when no alias candidate exists on disk", () => {
    const matcher = () => ["/proj/src/does/not/exist"];

    expect(ownResolve("app/ghost", "file:///proj/a.ts", matcher, fsWith())).toBeNull();
  });

  it("falls through to null for a bare specifier the matcher does not map", () => {
    const matcher = () => [] as string[];

    expect(ownResolve("react", "file:///proj/a.ts", matcher, fsWith())).toBeNull();
  });
});
