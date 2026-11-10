import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Application } from "../src/commands/create-new-app/types";
import { App } from "../src/helpers/app";
import { setPackageManager } from "../src/helpers/package-manager";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules") return [];
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

describe("no-database scaffold", () => {
  let workdir: string;
  let appPath: string;

  beforeEach(() => {
    setPackageManager("yarn");
    workdir = mkdtempSync(path.join(tmpdir(), "create-warlock-nodb-"));
    appPath = path.join(workdir, "generated-app");

    const descriptor: Application = {
      appName: "generated-app",
      appType: "warlock",
      appPath,
      pkgManager: "yarn",
      options: {
        databaseDriver: "none",
        databasePort: 0,
        features: ["web"],
        aiProviders: [],
        useGit: false,
        useJWT: false,
      },
    };

    new App(descriptor)
      .use("warlock")
      .updatePackageJson()
      .updateDotEnv()
      .removeDatabaseConfig()
      .removeDatabaseModules()
      .configureWebStarter(true);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("removes the model-backed modules and their config", () => {
    for (const removed of [
      "src/app/users",
      "src/app/auth",
      "src/app/posts",
      "src/config/auth.ts",
      "src/config/database.ts",
    ]) {
      expect(existsSync(path.join(appPath, removed)), removed).toBe(false);
    }
  });

  it("keeps the modules that do not need a database", () => {
    for (const kept of [
      "src/app/home",
      "src/app/contact",
      "src/app/locale",
      "src/app/uploads/routes.ts",
      "src/app/shared/utils/router.ts",
      "warlock.config.ts",
    ]) {
      expect(existsSync(path.join(appPath, kept)), kept).toBe(true);
    }
  });

  it("leaves no source file importing a removed module or the auth package", () => {
    const sources = filesUnder(path.join(appPath, "src")).concat(
      path.join(appPath, "warlock.config.ts"),
    );
    const dangling = /(app\/(users|auth|posts)\b|["']@warlock\.js\/auth["']|config\/auth)/;

    for (const file of sources.filter((item) => /\.(ts|tsx)$/.test(item))) {
      expect(readFileSync(file, "utf8"), path.relative(appPath, file)).not.toMatch(dangling);
    }
  });

  it("resolves every relative import to an existing file", () => {
    const sources = filesUnder(path.join(appPath, "src")).filter((item) =>
      /\.(ts|tsx)$/.test(item),
    );

    for (const file of sources) {
      for (const match of readFileSync(file, "utf8").matchAll(/from "(\.{1,2}\/[^"]*)"/g)) {
        const base = path.resolve(path.dirname(file), match[1]!);
        const found = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".json"].some((suffix) =>
          existsSync(base + suffix),
        );
        expect(found, `${path.relative(appPath, file)} -> ${match[1]}`).toBe(true);
      }
    }
  });

  it("writes .env and .env.example without DB_* or JWT_* entries", () => {
    for (const envFile of [".env", ".env.example"]) {
      const content = readFileSync(path.join(appPath, envFile), "utf8");
      expect(content, envFile).not.toMatch(/^DB_/m);
      expect(content, envFile).not.toMatch(/^JWT_/m);
      expect(content, envFile).not.toMatch(/Database Configurations/);
      expect(content, envFile).toMatch(/^HTTP_PORT=/m);
    }
  });

  it("drops the auth dependency and the migration / seed / jwt scripts", () => {
    const pkg = JSON.parse(readFileSync(path.join(appPath, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(pkg.dependencies["@warlock.js/auth"]).toBeUndefined();
    for (const script of ["migrate", "migrate.fresh", "migrate.list", "seed", "jwt"]) {
      expect(pkg.scripts[script], script).toBeUndefined();
    }
    expect(pkg.scripts.dev).toBeDefined();
  });

  it("rewrites warlock.config.ts without auth commands or migrations", () => {
    const config = readFileSync(path.join(appPath, "warlock.config.ts"), "utf8");

    expect(config).not.toMatch(/auth|migrations/i);
    expect(config).toContain("defineConfig");
  });

  it("keeps publicRoutes in the shared router helper and drops guarded", () => {
    const router = readFileSync(path.join(appPath, "src/app/shared/utils/router.ts"), "utf8");

    expect(router).toContain("export function publicRoutes");
    expect(router).not.toContain("guarded");
    expect(router).not.toContain("authMiddleware");
  });

  it("removes the @warlock.js/auth typings augmentation", () => {
    const typings = readFileSync(path.join(appPath, "src/typings.d.ts"), "utf8");

    expect(typings).not.toContain("@warlock.js/auth");
    expect(typings).toContain("export {};");
  });
});
