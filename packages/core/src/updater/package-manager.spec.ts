import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPackageManager, detectPackageManagerDetails } from "./package-manager";

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

  it.each([
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
  ])("prefers %s to a workspace marker at the same level", async (lockfile, expected) => {
    writeFileSync(path.join(app, "pnpm-workspace.yaml"), "allowBuilds: {}\n");
    writeFileSync(path.join(app, lockfile), "{}");
    expect(await detectPackageManager(app)).toBe(expected);
  });

  it("retains a locked pnpm workspace ahead of compatibility lockfiles", async () => {
    for (const file of ["pnpm-workspace.yaml", "pnpm-lock.yaml", "bun.lock", "package-lock.json"])
      writeFileSync(path.join(app, file), "{}");
    expect(await detectPackageManager(app)).toBe("pnpm");
  });

  it("honours the parent lockfile alongside its workspace marker", async () => {
    writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), "allowBuilds: {}\n");
    writeFileSync(path.join(tmp, "package-lock.json"), "{}");
    expect(await detectPackageManager(app)).toBe("npm");
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

  it("uses the most recently written lockfile when several share a level", async () => {
    writeFileSync(path.join(app, "package-lock.json"), "{}");
    writeFileSync(path.join(app, "pnpm-lock.yaml"), "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(path.join(app, "pnpm-lock.yaml"), old, old);

    const npm = await detectPackageManagerDetails(app);
    expect(npm.packageManager).toBe("npm");
    expect(npm.ambiguous).toEqual(["pnpm-lock.yaml", "package-lock.json"]);

    utimesSync(path.join(app, "package-lock.json"), old, old);
    utimesSync(path.join(app, "pnpm-lock.yaml"), new Date(), new Date());
    expect(await detectPackageManager(app)).toBe("pnpm");
  });

  it("keeps bun when bun.lock sits next to the yarn.lock bun also writes", async () => {
    writeFileSync(path.join(app, "yarn.lock"), "");
    writeFileSync(path.join(app, "bun.lock"), "{}");
    expect(await detectPackageManager(app)).toBe("bun");
  });

  it("reports no ambiguity for a single lockfile or a packageManager field", async () => {
    writeFileSync(path.join(app, "package-lock.json"), "{}");
    expect((await detectPackageManagerDetails(app)).ambiguous).toEqual([]);
    writeFileSync(path.join(app, "pnpm-lock.yaml"), "");
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ packageManager: "pnpm@9" }));
    expect(await detectPackageManagerDetails(app)).toEqual({
      packageManager: "pnpm",
      ambiguous: [],
    });
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
