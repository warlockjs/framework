import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installedVersion, readAppInfo } from "../src/app-versions";
import { developmentSessionView } from "../src/server/session-routes";

const folders: string[] = [];

function project(files: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(tmpdir(), "devtools-versions-"));

  folders.push(root);

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), JSON.stringify(content));
  }

  return root;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("readAppInfo", () => {
  it("reads only the name and version", () => {
    const root = project({
      "package.json": { name: "formai", version: "1.5.6", scripts: { x: "y" }, secret: "token" },
    });

    expect(readAppInfo(root)).toEqual({ name: "formai", version: "1.5.6" });
  });

  it("is null when the file is missing or lacks a name or version", () => {
    expect(readAppInfo(project({}))).toBeNull();
    expect(readAppInfo(project({ "package.json": { name: "formai" } }))).toBeNull();
    expect(readAppInfo(project({ "package.json": { version: "1.0.0" } }))).toBeNull();
  });
});

describe("installedVersion", () => {
  it("finds the package in a node_modules folder above the start folder", () => {
    const root = project({
      "node_modules/@warlock.js/core/package.json": { name: "@warlock.js/core", version: "5.58.0" },
    });

    expect(installedVersion("@warlock.js/core", path.join(root, "src"), undefined)).toBe("5.58.0");
  });

  it("is null when the package is not installed", () => {
    expect(installedVersion("@warlock.js/not-there", project({}), undefined)).toBeNull();
  });
});

describe("development session view", () => {
  it("carries the Warlock version and the app info fields", () => {
    const view = developmentSessionView({} as never);

    expect(view).toHaveProperty("warlockVersion");
    expect(view).toHaveProperty("app");
  });
});
