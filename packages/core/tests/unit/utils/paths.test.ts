import config from "@mongez/config";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appPath,
  cachePath,
  configPath,
  logsPath,
  publicPath,
  rootPath,
  sanitizePath,
  srcPath,
  storagePath,
  tempPath,
  uploadsPath,
  warlockPath,
} from "../../../src/utils/paths";

const root = process.cwd();

afterEach(() => {
  config.set("uploads.root", undefined);
});

describe("rootPath", () => {
  it("resolves to the current working directory with no arguments", () => {
    expect(rootPath()).toBe(path.resolve(root));
  });

  it("joins extra segments onto the root", () => {
    expect(rootPath("a", "b")).toBe(path.resolve(root, "a", "b"));
  });
});

describe("directory helpers", () => {
  it("srcPath nests under src", () => {
    expect(srcPath("app")).toBe(path.resolve(root, "src", "app"));
  });

  it("storagePath nests under storage", () => {
    expect(storagePath("file.txt")).toBe(path.resolve(root, "storage", "file.txt"));
  });

  it("publicPath nests under public", () => {
    expect(publicPath("robots.txt")).toBe(path.resolve(root, "public", "robots.txt"));
  });

  it("cachePath nests under storage/cache", () => {
    expect(cachePath("data")).toBe(path.resolve(root, "storage", "cache", "data"));
  });

  it("appPath nests under src/app", () => {
    expect(appPath("users")).toBe(path.resolve(root, "src/app", "users"));
  });

  it("logsPath nests under storage/logs", () => {
    expect(logsPath("app.log")).toBe(path.resolve(root, "storage/logs", "app.log"));
  });

  it("tempPath nests under storage/tmp", () => {
    expect(tempPath("x")).toBe(path.resolve(root, "storage/tmp", "x"));
  });

  it("warlockPath nests under .warlock", () => {
    expect(warlockPath("cache")).toBe(path.resolve(root, ".warlock", "cache"));
  });

  it("configPath nests under src/config", () => {
    expect(configPath("app.ts")).toBe(path.resolve(root, "src/config", "app.ts"));
  });
});

describe("uploadsPath", () => {
  it("defaults to storage/uploads when no config override is set", () => {
    expect(uploadsPath("avatar.png")).toBe(
      path.resolve(root, "storage", "uploads", "avatar.png"),
    );
  });

  it("resolves against a configured string root", () => {
    config.set("uploads.root", "/srv/files");

    expect(uploadsPath("avatar.png")).toBe(path.resolve("/srv/files", "avatar.png"));
  });

  it("delegates to a configured function root", () => {
    config.set("uploads.root", (relativePath: string) => `cloud://bucket/${relativePath}`);

    expect(uploadsPath("avatar.png")).toBe("cloud://bucket/avatar.png");
  });
});

describe("sanitizePath", () => {
  it("strips characters that are illegal in file paths", () => {
    expect(sanitizePath('a<b>c:"d/e\\f|g?h*i')).toBe("abcdefghi");
  });

  it("keeps letters, numbers, dashes, underscores and dots", () => {
    expect(sanitizePath("my-file_v2.0.png")).toBe("my-file_v2.0.png");
  });
});
