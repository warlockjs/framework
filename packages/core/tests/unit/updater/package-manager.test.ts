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
  // Lockfiles side by side are ordered by modification time; these tests only
  // need every mocked lockfile to exist with the same timestamp.
  stat: async (file: string) => {
    if (!existingFiles.has(file)) throw new Error("ENOENT");

    return { mtimeMs: 0 };
  },
}));

vi.mock("../../../src/utils", () => ({
  rootPath: (file = "") => path.join(path.resolve("/project"), file),
}));

const {
  detectPackageManager,
  detectPackageManagerDetails,
  getAddCommand,
  getExactAddCommand,
  getInstallCommand,
} = await import("../../../src/updater/package-manager");

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

  it("trusts what installed node_modules over a stale pnpm workspace and lockfile", async () => {
    withLockfiles("pnpm-workspace.yaml", "pnpm-lock.yaml", "package-lock.json");
    existingFiles.add(path.join(projectRoot, "node_modules", ".package-lock.json"));

    const detection = await detectPackageManagerDetails(projectRoot);

    expect(detection.packageManager).toBe("npm");
    expect(detection.reason).toContain("node_modules");
  });

  it.each([
    [".pnpm", "pnpm"],
    [".modules.yaml", "pnpm"],
    [".yarn-state.yml", "yarn"],
    [".yarn-integrity", "yarn"],
    [".bun", "bun"],
  ])("reads the node_modules/%s marker as %s", async (marker, expected) => {
    withLockfiles("package-lock.json");
    existingFiles.add(path.join(projectRoot, "node_modules", marker));

    await expect(detectPackageManager(projectRoot)).resolves.toBe(expected);
  });

  it("does not let a pnpm-workspace.yaml outrank a lockfile", async () => {
    withLockfiles("pnpm-workspace.yaml", "package-lock.json");

    await expect(detectPackageManager(projectRoot)).resolves.toBe("npm");
  });

  it("uses a pnpm-workspace.yaml only when there is no lockfile or marker", async () => {
    withLockfiles("pnpm-workspace.yaml");

    await expect(detectPackageManager(projectRoot)).resolves.toBe("pnpm");
  });

  it("prefers the packageManager field over the node_modules marker", async () => {
    withLockfiles();
    existingFiles.add(path.join(projectRoot, "node_modules", ".package-lock.json"));
    packageJsons.set(path.join(projectRoot, "package.json"), '{"packageManager":"yarn@4.1.0"}');

    await expect(detectPackageManager(projectRoot)).resolves.toBe("yarn");
  });

  it("explains which signal decided", async () => {
    withLockfiles("yarn.lock");

    const detection = await detectPackageManagerDetails(projectRoot);

    expect(detection.reason).toContain("yarn.lock");
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
