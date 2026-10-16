import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pnpmVersion: string | undefined = "11.28.6";

// These scaffolds use pnpm; pin its version so the result never depends on the
// pnpm installed on the machine running the suite.
vi.mock("../src/helpers/package-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/helpers/package-manager")>()),
  getPackageManager: () => "pnpm",
  getPnpmVersion: () => pnpmVersion,
}));

import { Application } from "../src/commands/create-new-app/types";
import { App } from "../src/helpers/app";

const templateDir = path.resolve(__dirname, "../templates/warlock");

function makeApplication(appPath: string, driver = "postgres"): Application {
  return {
    appName: "web",
    appType: "warlock",
    appPath,
    pkgManager: "pnpm",
    options: {
      databaseDriver: driver,
      databasePort: 5432,
      features: [],
      aiProviders: [],
      useGit: false,
      useJWT: false,
      agents: ["claude"],
    },
  } as unknown as Application;
}

describe("scaffold bugs (5.22.1)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cw-bugs-"));
    pnpmVersion = "11.28.6";
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("bug 2: skips the per-app pnpm-workspace.yaml inside an existing workspace", () => {
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    const appPath = path.join(root, "apps", "web");
    mkdirSync(path.dirname(appPath), { recursive: true });

    new App(makeApplication(appPath)).use("warlock");

    expect(existsSync(path.join(appPath, "pnpm-workspace.yaml"))).toBe(false);
  });

  it("bug 2: still writes pnpm-workspace.yaml for a standalone app", () => {
    const appPath = path.join(root, "solo");

    new App(makeApplication(appPath)).use("warlock");

    expect(existsSync(path.join(appPath, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("bug 3: postgres writes its own defaults to .env and .env.example", () => {
    const appPath = path.join(root, "web");

    new App(makeApplication(appPath))
      .use("warlock")
      .updateDotEnv()
      .configureDatabaseEnv("postgres");

    for (const file of [".env", ".env.example"]) {
      const env = readFileSync(path.join(appPath, file), "utf8");
      expect(env, file).not.toContain("DB_AUTH");
      expect(env, file).toContain("DB_PORT=5432");
      expect(env, file).toContain("DB_DRIVER=postgres");
    }
  });

  it("bug 3: mongodb keeps DB_AUTH and 27017 in both files", () => {
    const appPath = path.join(root, "web");

    new App(makeApplication(appPath, "mongodb")).use("warlock").configureDatabaseEnv("mongodb");

    for (const file of [".env", ".env.example"]) {
      const env = readFileSync(path.join(appPath, file), "utf8");
      expect(env, file).toContain("DB_AUTH=admin");
      expect(env, file).toContain("DB_PORT=27017");
    }
  });

  it("bug 4: gen.* scripts use the registered `warlock generate.<x>` form", () => {
    const scripts = JSON.parse(readFileSync(path.join(templateDir, "package.json"), "utf8"))
      .scripts as Record<string, string>;

    expect(scripts["gen.s"]).toBe("warlock generate.service");
    expect(scripts["gen.m"]).toBe("warlock generate.model");
    expect(scripts["gen.c"]).toBe("warlock generate.controller");
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(cmd, name).not.toMatch(/warlock\.generate/);
    }
  });

  it("bug 5: release-age exclude covers the scope by pattern, never a non-dependency", () => {
    const yaml = readFileSync(path.join(templateDir, "pnpm-workspace.yaml"), "utf8");
    const pkg = JSON.parse(readFileSync(path.join(templateDir, "package.json"), "utf8"));

    expect(yaml).toMatch(/minimumReleaseAgeExclude:\s*\n\s*-\s*['"]?@warlock\.js\/\*['"]?/);
    expect(yaml).not.toContain("@warlock.js/context");
    expect(Object.keys(pkg.dependencies)).not.toContain("@warlock.js/context");
  });

  describe("pnpm settings follow the user's pnpm version (5.30.0)", () => {
    const templateYaml = () => readFileSync(path.join(templateDir, "pnpm-workspace.yaml"), "utf8");
    const readPackageJson = (appPath: string) =>
      JSON.parse(readFileSync(path.join(appPath, "package.json"), "utf8"));

    it.each(["7.33.7", "9.15.9", "10.0.0", "10.4.0"])(
      "pnpm %s: no workspace file (it would fail 'packages field missing or empty'); esbuild approved in package.json",
      (version) => {
        pnpmVersion = version;
        const appPath = path.join(root, "solo");

        new App(makeApplication(appPath)).use("warlock").updatePackageJson();

        expect(existsSync(path.join(appPath, "pnpm-workspace.yaml"))).toBe(false);
        expect(readPackageJson(appPath).pnpm).toEqual({ onlyBuiltDependencies: ["esbuild"] });
      },
    );

    it.each(["10.5.0", "10.25.0"])(
      "pnpm %s: keeps the settings-only workspace file and adds onlyBuiltDependencies",
      (version) => {
        pnpmVersion = version;
        const appPath = path.join(root, "solo");

        new App(makeApplication(appPath)).use("warlock");

        const yaml = readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8");
        expect(yaml).toContain("allowBuilds:\n  esbuild: true");
        expect(yaml).toMatch(/^onlyBuiltDependencies:\n  - esbuild$/m);
        expect(yaml).not.toMatch(/^packages:/m);
        expect(readPackageJson(appPath).pnpm).toBeUndefined();
      },
    );

    it.each(["10.26.0", "11.28.6", "12.11.2", undefined])(
      "pnpm %s: writes the template's workspace file unchanged",
      (version) => {
        pnpmVersion = version;
        const appPath = path.join(root, "solo");

        new App(makeApplication(appPath)).use("warlock");

        expect(readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8")).toBe(
          templateYaml(),
        );
        expect(readPackageJson(appPath).pnpm).toBeUndefined();
      },
    );

    it("pnpm 9 inside an existing workspace: the parent owns the policy, so package.json gets no pnpm field", () => {
      pnpmVersion = "9.15.9";
      writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
      const appPath = path.join(root, "apps", "web");
      mkdirSync(path.dirname(appPath), { recursive: true });

      new App(makeApplication(appPath)).use("warlock");

      expect(existsSync(path.join(appPath, "pnpm-workspace.yaml"))).toBe(false);
      expect(readPackageJson(appPath).pnpm).toBeUndefined();
    });

    it("approves sharp where each version reads it when the image feature is selected", () => {
      for (const [version, check] of [
        [
          "9.15.9",
          (appPath: string) =>
            expect(readPackageJson(appPath).pnpm.onlyBuiltDependencies).toEqual([
              "esbuild",
              "sharp",
            ]),
        ],
        [
          "10.20.0",
          (appPath: string) => {
            const yaml = readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8");
            expect(yaml).toMatch(/^  sharp: true$/m);
            expect(yaml).toMatch(/^  - sharp$/m);
          },
        ],
        [
          "11.28.6",
          (appPath: string) => {
            const yaml = readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8");
            expect(yaml).toMatch(/^  sharp: true$/m);
            expect(yaml).not.toMatch(/onlyBuiltDependencies/);
          },
        ],
      ] as const) {
        pnpmVersion = version;
        const appPath = path.join(root, `image-${version}`);

        new App(makeApplication(appPath)).use("warlock").approveSelectedFeatureBuilds(["image"]);

        check(appPath);
      }
    });
  });
});
