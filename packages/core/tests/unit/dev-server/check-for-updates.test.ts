import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchLatestVersion = vi.fn();
const getWarlockVersion = vi.fn(async () => "4.8.2");
const getConfig = vi.fn(async () => ({}) as Record<string, unknown> | undefined);
const updateWarlockPackages = vi.fn();
const restartDevServer = vi.fn(async () => true);
const register = vi.fn(() => true);
const unregister = vi.fn();
const release = vi.fn();
const resume = vi.fn();
const readCachedLatestVersion = vi.fn(async (): Promise<string | undefined> => undefined);
const writeCachedLatestVersion = vi.fn(async () => undefined);
const clearCachedLatestVersion = vi.fn(async () => undefined);

vi.mock("../../../src/utils/npm-registry", () => ({
  fetchLatestVersion: (...args: unknown[]) => fetchLatestVersion(...args),
}));

vi.mock("../../../src/utils/framework-vesion", () => ({
  getWarlockVersion: () => getWarlockVersion(),
}));

vi.mock("../../../src/warlock-config", () => ({
  warlockConfigManager: { get: (key: string) => getConfig(key as never) },
}));

vi.mock("../../../src/updater/update-warlock-packages", () => ({
  updateWarlockPackages: (...args: unknown[]) => updateWarlockPackages(...args),
}));

vi.mock("../../../src/dev-server/restart-dev-server", () => ({
  restartDevServer: (...args: unknown[]) => restartDevServer(...args),
}));

vi.mock("../../../src/dev-server/shortcuts", () => ({
  devServerShortcuts: {
    register: (...args: unknown[]) => register(...(args as [])),
    unregister: (...args: unknown[]) => unregister(...args),
    release: () => release(),
    resume: () => resume(),
  },
}));

vi.mock("../../../src/dev-server/update-check-cache", () => ({
  readCachedLatestVersion: () => readCachedLatestVersion(),
  writeCachedLatestVersion: (...args: unknown[]) => writeCachedLatestVersion(...(args as [])),
  clearCachedLatestVersion: () => clearCachedLatestVersion(),
}));

const { checkForFrameworkUpdate } = await import("../../../src/dev-server/check-for-updates");

/** A stand-in for the running server — only ever passed through to restart. */
const devServer = {} as never;

/** Everything printed by the notice, joined for easy matching. */
let output: string[] = [];

const printed = () => output.join("\n");

describe("checkForFrameworkUpdate", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalCI = process.env.CI;
  const originalNotifier = process.env.NO_UPDATE_NOTIFIER;

  beforeEach(() => {
    vi.clearAllMocks();

    output = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.join(" "));
    });

    process.stdout.isTTY = true;
    delete process.env.CI;
    delete process.env.NO_UPDATE_NOTIFIER;

    getWarlockVersion.mockResolvedValue("4.8.2");
    getConfig.mockResolvedValue({});
    register.mockReturnValue(true);
    restartDevServer.mockResolvedValue(true);
    readCachedLatestVersion.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();

    process.stdout.isTTY = originalIsTTY;
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    if (originalNotifier === undefined) delete process.env.NO_UPDATE_NOTIFIER;
    else process.env.NO_UPDATE_NOTIFIER = originalNotifier;
  });

  describe("offline", () => {
    it("stays silent and does not reject when the registry cannot be reached", async () => {
      fetchLatestVersion.mockResolvedValue(undefined);

      await expect(checkForFrameworkUpdate(devServer)).resolves.toBeUndefined();

      expect(printed()).toBe("");
      expect(register).not.toHaveBeenCalled();
    });

    it("does not reject even if the lookup itself throws", async () => {
      fetchLatestVersion.mockRejectedValue(new TypeError("fetch failed"));

      await expect(checkForFrameworkUpdate(devServer)).resolves.toBeUndefined();

      expect(printed()).toBe("");
    });

    it("does not reject when reading the config throws", async () => {
      getConfig.mockRejectedValue(new Error("bad warlock.config.ts"));

      await expect(checkForFrameworkUpdate(devServer)).resolves.toBeUndefined();

      expect(fetchLatestVersion).not.toHaveBeenCalled();
    });

    it("uses a short abort budget so a hanging network cannot linger", async () => {
      fetchLatestVersion.mockResolvedValue(undefined);

      await checkForFrameworkUpdate(devServer);

      const [, timeoutMs] = fetchLatestVersion.mock.calls[0] as [string, number];

      expect(timeoutMs).toBeLessThanOrEqual(10_000);
    });
  });

  describe("the registry cache", () => {
    it("uses a fresh cached answer instead of hitting npm", async () => {
      readCachedLatestVersion.mockResolvedValue("4.9.0");

      await checkForFrameworkUpdate(devServer);

      expect(fetchLatestVersion).not.toHaveBeenCalled();
      expect(printed()).toContain("4.9.0");
    });

    it("asks npm and remembers the answer when there is no usable cache", async () => {
      fetchLatestVersion.mockResolvedValue("4.9.0");

      await checkForFrameworkUpdate(devServer);

      expect(fetchLatestVersion).toHaveBeenCalledOnce();
      expect(writeCachedLatestVersion).toHaveBeenCalledWith("4.9.0");
    });

    it("never caches a failed lookup — one flaky moment must not silence a day", async () => {
      fetchLatestVersion.mockResolvedValue(undefined);

      await checkForFrameworkUpdate(devServer);

      expect(writeCachedLatestVersion).not.toHaveBeenCalled();
    });

    it("forgets the cached answer once an update has been applied", async () => {
      const handler = await (async () => {
        fetchLatestVersion.mockResolvedValue("4.9.0");
        await checkForFrameworkUpdate(devServer);
        const [shortcut] = register.mock.calls[0] as unknown as [{ handler: () => Promise<void> }];
        return shortcut.handler;
      })();

      updateWarlockPackages.mockResolvedValue({ outcome: "updated", updates: [] });

      await handler();

      expect(clearCachedLatestVersion).toHaveBeenCalledOnce();
    });

    it("keeps the cached answer when nothing was updated", async () => {
      fetchLatestVersion.mockResolvedValue("4.9.0");
      await checkForFrameworkUpdate(devServer);
      const [shortcut] = register.mock.calls[0] as unknown as [{ handler: () => Promise<void> }];

      updateWarlockPackages.mockResolvedValue({ outcome: "registry-unreachable", updates: [] });

      await shortcut.handler();

      expect(clearCachedLatestVersion).not.toHaveBeenCalled();
    });
  });

  describe("opt-outs", () => {
    it.each([
      ["CI", () => (process.env.CI = "1")],
      ["NO_UPDATE_NOTIFIER", () => (process.env.NO_UPDATE_NOTIFIER = "1")],
      ["a non-TTY stdout", () => (process.stdout.isTTY = false)],
    ])("never touches the network with %s", async (_label, apply) => {
      apply();

      await checkForFrameworkUpdate(devServer);

      expect(fetchLatestVersion).not.toHaveBeenCalled();
    });

    it("never touches the network when devServer.checkForUpdates is false", async () => {
      getConfig.mockResolvedValue({ checkForUpdates: false });

      await checkForFrameworkUpdate(devServer);

      expect(fetchLatestVersion).not.toHaveBeenCalled();
    });
  });

  describe("the notice", () => {
    it("stays silent when the published version is not newer", async () => {
      fetchLatestVersion.mockResolvedValue("4.8.2");

      await checkForFrameworkUpdate(devServer);

      expect(printed()).toBe("");
      expect(register).not.toHaveBeenCalled();
    });

    it("advertises the u shortcut when the terminal can deliver keypresses", async () => {
      fetchLatestVersion.mockResolvedValue("4.9.0");

      await checkForFrameworkUpdate(devServer);

      expect(printed()).toContain("4.9.0");
      expect(printed()).toContain("Press");
      expect(printed()).toContain("to update all @warlock.js packages and restart");
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ key: "u" }));
    });

    it("falls back to the command when no shortcut could be armed", async () => {
      fetchLatestVersion.mockResolvedValue("4.9.0");
      register.mockReturnValue(false);

      await checkForFrameworkUpdate(devServer);

      expect(printed()).toContain("npx warlock update");
      expect(printed()).not.toContain("Press");
    });

    it("falls back to the command when there is no server to restart", async () => {
      fetchLatestVersion.mockResolvedValue("4.9.0");

      await checkForFrameworkUpdate();

      expect(register).not.toHaveBeenCalled();
      expect(printed()).toContain("npx warlock update");
    });
  });

  describe("the u handler", () => {
    /** Arm the shortcut and hand back the handler the notice registered. */
    async function armShortcut(): Promise<() => Promise<void>> {
      fetchLatestVersion.mockResolvedValue("4.9.0");

      await checkForFrameworkUpdate(devServer);

      const [shortcut] = register.mock.calls[0] as unknown as [
        { handler: () => Promise<void> },
      ];

      return shortcut.handler;
    }

    it("updates then restarts", async () => {
      const handler = await armShortcut();

      updateWarlockPackages.mockResolvedValue({ outcome: "updated", updates: [] });

      await handler();

      expect(unregister).toHaveBeenCalledWith("u");
      expect(updateWarlockPackages).toHaveBeenCalled();
      expect(restartDevServer).toHaveBeenCalledWith(devServer);
    });

    it("hands the terminal to the package manager and keeps it once restarting", async () => {
      const handler = await armShortcut();

      updateWarlockPackages.mockResolvedValue({ outcome: "updated", updates: [] });

      await handler();

      // Raw mode must be off before the install child inherits stdio, and must
      // stay off afterwards — the replacement process owns the terminal now.
      expect(release).toHaveBeenCalledOnce();
      expect(release.mock.invocationCallOrder[0]).toBeLessThan(
        updateWarlockPackages.mock.invocationCallOrder[0],
      );
      expect(resume).not.toHaveBeenCalled();
    });

    it("takes the terminal back when it is not restarting", async () => {
      const handler = await armShortcut();

      updateWarlockPackages.mockResolvedValue({ outcome: "up-to-date", updates: [] });

      await handler();

      expect(release).toHaveBeenCalledOnce();
      expect(resume).toHaveBeenCalledOnce();
    });

    it("keeps serving and re-arms the shortcut when the registry is unreachable", async () => {
      const handler = await armShortcut();

      updateWarlockPackages.mockResolvedValue({ outcome: "registry-unreachable", updates: [] });
      register.mockClear();

      await expect(handler()).resolves.toBeUndefined();

      expect(restartDevServer).not.toHaveBeenCalled();
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ key: "u" }));
      expect(printed()).toContain("to try again once you are back online");
    });

    it("does not restart, nor re-arm, after a failed install", async () => {
      const handler = await armShortcut();

      updateWarlockPackages.mockResolvedValue({
        outcome: "install-failed",
        updates: [],
        error: new Error("npm ERR!"),
      });
      register.mockClear();

      await expect(handler()).resolves.toBeUndefined();

      expect(restartDevServer).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });

    it("tells the developer to restart by hand when the restart could not start", async () => {
      const handler = await armShortcut();

      updateWarlockPackages.mockResolvedValue({ outcome: "updated", updates: [] });
      restartDevServer.mockResolvedValue(false);

      await handler();

      expect(printed()).toContain("Restart the dev server manually");
    });
  });
});
