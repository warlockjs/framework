import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPackageManager } from "./package-manager";

describe("detectPackageManager", () => {
  let tmp: string;
  let app: string;
  const originalAgent = process.env.npm_config_user_agent;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "warlock-pm-"));
    app = path.join(tmp, "apps", "web");
    mkdirSync(app, { recursive: true });
    delete process.env.npm_config_user_agent;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (originalAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = originalAgent;
  });

  it("detects pnpm from a parent pnpm-workspace.yaml", async () => {
    writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    expect(await detectPackageManager(app)).toBe("pnpm");
  });

  it("detects a lockfile in a parent directory", async () => {
    writeFileSync(path.join(tmp, "yarn.lock"), "");
    expect(await detectPackageManager(app)).toBe("yarn");
  });

  it("prefers the app's packageManager field over lockfiles", async () => {
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ packageManager: "yarn@4.1.0" }));
    writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    expect(await detectPackageManager(app)).toBe("yarn");
  });

  it("prefers a pnpm workspace over a stray package-lock.json in the app", async () => {
    writeFileSync(path.join(app, "package-lock.json"), "{}");
    writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(app)).toBe("pnpm");
  });

  it("prefers pnpm-lock.yaml over package-lock.json at the same level", async () => {
    writeFileSync(path.join(app, "package-lock.json"), "{}");
    writeFileSync(path.join(app, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(app)).toBe("pnpm");
  });

  it("lets the app's packageManager field beat every other signal", async () => {
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ packageManager: "yarn@4" }));
    writeFileSync(path.join(app, "pnpm-lock.yaml"), "");
    writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    expect(await detectPackageManager(app)).toBe("yarn");
  });

  it("falls back to the npm user agent, then npm", async () => {
    process.env.npm_config_user_agent = "pnpm/9.0.0 npm/? node/v20";
    expect(await detectPackageManager(app)).toBe("pnpm");
    delete process.env.npm_config_user_agent;
    expect(await detectPackageManager(app)).toBe("npm");
  });
});
