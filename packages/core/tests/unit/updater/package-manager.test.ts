import { beforeEach, describe, expect, it, vi } from "vitest";

const existingFiles = new Set<string>();

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: async (path: string) => existingFiles.has(path),
}));

vi.mock("../../../src/utils", () => ({
  rootPath: (file: string) => `/project/${file}`,
}));

const { detectPackageManager, getAddCommand, getExactAddCommand, getInstallCommand } =
  await import("../../../src/updater/package-manager");

/** Pretend the project root carries exactly these lockfiles. */
function withLockfiles(...files: string[]) {
  existingFiles.clear();

  for (const file of files) {
    existingFiles.add(`/project/${file}`);
  }
}

describe("detectPackageManager", () => {
  beforeEach(() => existingFiles.clear());

  it.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["pnpm-lock.yaml", "pnpm"],
  ])("detects %s as %s", async (lockfile, expected) => {
    withLockfiles(lockfile);

    await expect(detectPackageManager()).resolves.toBe(expected);
  });

  it("falls back to npm when the project has no lockfile", async () => {
    withLockfiles();

    await expect(detectPackageManager()).resolves.toBe("npm");
  });

  it("prefers bun over a yarn.lock written alongside it", async () => {
    // Bun writes a yarn.lock for tooling compatibility, so a project can
    // legitimately carry both — running yarn there is the wrong installer.
    withLockfiles("bun.lock", "yarn.lock");

    await expect(detectPackageManager()).resolves.toBe("bun");
  });

  it("prefers the text bun.lock over the legacy binary bun.lockb", async () => {
    withLockfiles("bun.lockb", "bun.lock");

    await expect(detectPackageManager()).resolves.toBe("bun");
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
