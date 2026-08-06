import { beforeEach, describe, expect, it, vi } from "vitest";

const fileExistsAsync = vi.fn(async () => true);
const getJsonFileAsync = vi.fn();
const putJsonFileAsync = vi.fn(async () => undefined);
const fetchLatestVersion = vi.fn();
const execSync = vi.fn();

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: (...args: unknown[]) => fileExistsAsync(...(args as [])),
  getJsonFileAsync: (...args: unknown[]) => getJsonFileAsync(...(args as [])),
  putJsonFileAsync: (...args: unknown[]) => putJsonFileAsync(...(args as [])),
}));

vi.mock("../../../src/utils/npm-registry", () => ({
  fetchLatestVersion: (...args: unknown[]) => fetchLatestVersion(...args),
}));

vi.mock("../../../src/utils", () => ({
  rootPath: (file: string) => `/project/${file}`,
}));

vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => execSync(...args),
}));

const { isRegistryUnreachable, updateWarlockPackages } = await import(
  "../../../src/updater/update-warlock-packages"
);

/** A minimal project that depends on two framework packages. */
const packageJson = () => ({
  dependencies: { "@warlock.js/core": "^4.8.2" },
  devDependencies: { "@warlock.js/cascade": "^4.8.2" },
});

describe("isRegistryUnreachable", () => {
  it("is true only when every lookup came back empty", () => {
    expect(
      isRegistryUnreachable([
        { name: "@warlock.js/core", section: "dependencies", current: "^4.8.2", latest: undefined },
        {
          name: "@warlock.js/cascade",
          section: "dependencies",
          current: "^4.8.2",
          latest: undefined,
        },
      ]),
    ).toBe(true);
  });

  it("is false when at least one lookup succeeded", () => {
    expect(
      isRegistryUnreachable([
        { name: "@warlock.js/core", section: "dependencies", current: "^4.8.2", latest: "4.9.0" },
        {
          name: "@warlock.js/cascade",
          section: "dependencies",
          current: "^4.8.2",
          latest: undefined,
        },
      ]),
    ).toBe(false);
  });

  it("is false with nothing to resolve", () => {
    expect(isRegistryUnreachable([])).toBe(false);
  });
});

describe("updateWarlockPackages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});

    fileExistsAsync.mockResolvedValue(true);
    getJsonFileAsync.mockResolvedValue(packageJson());
  });

  it("reports an unreachable registry instead of claiming everything is up to date", async () => {
    fetchLatestVersion.mockResolvedValue(undefined);

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("registry-unreachable");
    expect(result.updates).toEqual([]);
    // Nothing was rewritten and no install was attempted while offline.
    expect(putJsonFileAsync).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });

  it("reports up-to-date only when the registry actually answered", async () => {
    fetchLatestVersion.mockResolvedValue("4.8.2");

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("up-to-date");
    expect(putJsonFileAsync).not.toHaveBeenCalled();
  });

  it("rewrites the versions and installs when a newer release exists", async () => {
    fetchLatestVersion.mockResolvedValue("4.9.0");

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("updated");
    expect(result.updates.map(update => update.to)).toEqual(["^4.9.0", "^4.9.0"]);
    expect(putJsonFileAsync).toHaveBeenCalledOnce();
    expect(execSync).toHaveBeenCalledOnce();
  });

  it("skips the install with install: false", async () => {
    fetchLatestVersion.mockResolvedValue("4.9.0");

    const result = await updateWarlockPackages({ install: false });

    expect(result.outcome).toBe("updated");
    expect(putJsonFileAsync).toHaveBeenCalledOnce();
    expect(execSync).not.toHaveBeenCalled();
  });

  it("resolves with install-failed instead of throwing when the install blows up", async () => {
    fetchLatestVersion.mockResolvedValue("4.9.0");
    execSync.mockImplementation(() => {
      throw new Error("npm ERR! network request failed");
    });

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("install-failed");
    expect(result.error?.message).toContain("npm ERR!");
    // The rewritten package.json is kept — the developer only has to re-install.
    expect(putJsonFileAsync).toHaveBeenCalledOnce();
  });

  describe("dry run", () => {
    it("reports what would change without writing or installing", async () => {
      fetchLatestVersion.mockResolvedValue("4.9.0");

      const result = await updateWarlockPackages({ dryRun: true });

      expect(result.outcome).toBe("outdated");
      expect(result.updates.map((update) => update.to)).toEqual(["^4.9.0", "^4.9.0"]);
      expect(putJsonFileAsync).not.toHaveBeenCalled();
      expect(execSync).not.toHaveBeenCalled();
    });

    it("still reports up-to-date when nothing is behind", async () => {
      fetchLatestVersion.mockResolvedValue("4.8.2");

      const result = await updateWarlockPackages({ dryRun: true });

      expect(result.outcome).toBe("up-to-date");
    });

    it("still reports an unreachable registry rather than a clean bill", async () => {
      fetchLatestVersion.mockResolvedValue(undefined);

      const result = await updateWarlockPackages({ dryRun: true });

      expect(result.outcome).toBe("registry-unreachable");
    });
  });

  it("reports a missing package.json", async () => {
    fileExistsAsync.mockResolvedValue(false);

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("no-package-json");
  });

  it("reports a project with no @warlock.js dependencies", async () => {
    getJsonFileAsync.mockResolvedValue({ dependencies: { fastify: "^5.0.0" } });

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("no-packages");
    expect(fetchLatestVersion).not.toHaveBeenCalled();
  });
});
