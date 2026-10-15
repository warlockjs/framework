import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const existingFiles = new Set<string>();
const packageJsons = new Map<string, string>();

/** Controlled project root — detection walks up from here, never into the real repo. */
const projectRoot = path.resolve("/project");

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: async (path: string) => existingFiles.has(path),
}));

vi.mock("node:fs/promises", () => ({
  readFile: async (file: string) => {
    const content = packageJsons.get(file);

    if (content === undefined) throw new Error("ENOENT");

    return content;
  },
}));

vi.mock("../../../src/utils", () => ({
  rootPath: (file = "") => path.join(path.resolve("/project"), file),
}));

const { detectPackageManager, getAddCommand, getExactAddCommand, getInstallCommand } =
  await import("../../../src/updater/package-manager");

/** Pretend the project root carries exactly these lockfiles. */
function withLockfiles(...files: string[]) {
  existingFiles.clear();

  for (const file of files) {
    existingFiles.add(path.join(projectRoot, file));
  }
}

describe("detectPackageManager", () => {
  beforeEach(() => {
    existingFiles.clear();
    packageJsons.clear();
    // Hermetic: never inherit the invoking shell's package manager.
    vi.stubEnv("npm_config_user_agent", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["pnpm-lock.yaml", "pnpm"],
  ])("detects %s as %s", async (lockfile, expected) => {
    withLockfiles(lockfile);

    await expect(detectPackageManager(projectRoot)).resolves.toBe(expected);
  });

  it("falls back to npm when the project has no lockfile", async () => {
    withLockfiles();

    await expect(detectPackageManager(projectRoot)).resolves.toBe("npm");
  });

  it("prefers bun over a yarn.lock written alongside it", async () => {
    // Bun writes a yarn.lock for tooling compatibility, so a project can
    // legitimately carry both — running yarn there is the wrong installer.
    withLockfiles("bun.lock", "yarn.lock");

    await expect(detectPackageManager(projectRoot)).resolves.toBe("bun");
  });

  it("prefers the text bun.lock over the legacy binary bun.lockb", async () => {
    withLockfiles("bun.lockb", "bun.lock");

    await expect(detectPackageManager(projectRoot)).resolves.toBe("bun");
  });

  it("walks up to a parent directory's lockfile", async () => {
    existingFiles.add(path.join(path.resolve("/"), "yarn.lock"));

    await expect(detectPackageManager(path.join(projectRoot, "apps", "web"))).resolves.toBe("yarn");
  });

  it("honours the packageManager field over a lockfile", async () => {
    withLockfiles("package-lock.json");
    packageJsons.set(path.join(projectRoot, "package.json"), '{"packageManager":"pnpm@9.0.0"}');

    await expect(detectPackageManager(projectRoot)).resolves.toBe("pnpm");
  });

  it("falls back to the invoking user agent when nothing else identifies it", async () => {
    vi.stubEnv("npm_config_user_agent", "bun/1.1.0 npm/? node/v20");

    await expect(detectPackageManager(projectRoot)).resolves.toBe("bun");
  });
});

describe("install and add commands", () => {
  it.each([
    ["npm", "npm install", "npm install", "npm install --save-exact"],
    ["yarn", "yarn install", "yarn add", "yarn add --exact"],
    ["pnpm", "pnpm install", "pnpm add", "pnpm add --save-exact"],
    ["bun", "bun install", "bun add", "bun add --exact"],
  ] as const)("maps %s correctly", (packageManager, install, add, exactAdd) => {
    expect(getInstallCommand(packageManager)).toBe(install);
    expect(getAddCommand(packageManager)).toBe(add);
    expect(getExactAddCommand(packageManager)).toBe(exactAdd);
  });
});
