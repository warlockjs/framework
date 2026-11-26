import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pnpmVersion: string | undefined = "11.28.6";

vi.mock("../src/helpers/package-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/helpers/package-manager")>()),
  getPackageManager: () => "pnpm",
  getPnpmVersion: () => pnpmVersion,
}));

import { Application } from "../src/commands/create-new-app/types";
import { App } from "../src/helpers/app";
import {
  FEATURE_BUILD_APPROVALS,
  requiredPnpmBuildApprovals,
} from "../src/helpers/pnpm-build-approvals";

function makeApplication(appPath: string): Application {
  return {
    appName: "web",
    appType: "warlock",
    appPath,
    pkgManager: "pnpm",
    options: {
      databaseDriver: "postgres",
      databasePort: 5432,
      features: [],
      aiProviders: [],
      useGit: false,
      useJWT: false,
      agents: ["claude"],
    },
  } as unknown as Application;
}

/** Every feature that installs a dependency with an install script, and the packages to approve. */
const nativeBuildFeatures: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["image", ["sharp"]],
  ["queue", ["msgpackr-extract"]],
  ["bull-board", ["msgpackr-extract"]],
];

describe("native build approvals per feature", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cw-native-"));
    mkdirSync(root, { recursive: true });
    pnpmVersion = "11.28.6";
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("keeps the table in step with the features this spec lists", () => {
    expect(Object.keys(FEATURE_BUILD_APPROVALS).sort()).toEqual(
      nativeBuildFeatures.map(([feature]) => feature).sort(),
    );
  });

  it.each(nativeBuildFeatures)("%s: requires its native build packages", (feature, packages) => {
    expect(requiredPnpmBuildApprovals([feature])).toEqual(packages);
  });

  it.each(nativeBuildFeatures)(
    "%s: approved in the pnpm 11+ allowBuilds layout",
    (feature, packages) => {
      const appPath = path.join(root, `allow-${feature}`);

      new App(makeApplication(appPath)).use("warlock").approveSelectedFeatureBuilds([feature]);

      const yaml = readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8");
      for (const name of packages) expect(yaml).toMatch(new RegExp(`^  ${name}: true$`, "m"));
    },
  );

  it.each(nativeBuildFeatures)(
    "%s: approved in the pnpm 10 onlyBuiltDependencies layouts",
    (feature, packages) => {
      pnpmVersion = "10.20.0";
      const yamlApp = path.join(root, `yaml-${feature}`);

      new App(makeApplication(yamlApp)).use("warlock").approveSelectedFeatureBuilds([feature]);

      const yaml = readFileSync(path.join(yamlApp, "pnpm-workspace.yaml"), "utf8");
      for (const name of packages) expect(yaml).toMatch(new RegExp(`^  - ${name}$`, "m"));

      pnpmVersion = "9.15.9";
      const jsonApp = path.join(root, `json-${feature}`);

      new App(makeApplication(jsonApp)).use("warlock").approveSelectedFeatureBuilds([feature]);

      expect(existsSync(path.join(jsonApp, "pnpm-workspace.yaml"))).toBe(false);
      const pkg = JSON.parse(readFileSync(path.join(jsonApp, "package.json"), "utf8"));
      for (const name of packages) expect(pkg.pnpm.onlyBuiltDependencies).toContain(name);
    },
  );
});
