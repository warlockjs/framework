import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevServerShortcut } from "../../../src/dev-server/shortcuts";

const isSupported = vi.fn(() => true);
const register = vi.fn((_shortcut: DevServerShortcut) => true);
const list = vi.fn((): DevServerShortcut[] => []);
const resume = vi.fn();
const restartDevServer = vi.fn(async () => true);
const shutdown = vi.fn(async () => undefined);

vi.mock("../../../src/dev-server/shortcuts", () => ({
  devServerShortcuts: {
    isSupported: () => isSupported(),
    register: (shortcut: DevServerShortcut) => register(shortcut),
    list: () => list(),
    resume: () => resume(),
  },
}));

vi.mock("../../../src/dev-server/restart-dev-server", () => ({
  restartDevServer: (...args: unknown[]) => restartDevServer(...(args as [])),
}));

const { registerDevShortcuts } = await import("../../../src/dev-server/register-dev-shortcuts");

/** Just enough of a dev server for the quit/restart handlers. */
const devServer = { shutdown } as never;

let output: string[] = [];

const printed = () => output.join("\n");

/** The shortcut registered under `key`, or undefined. */
function armed(key: string): DevServerShortcut | undefined {
  return register.mock.calls.map(([shortcut]) => shortcut).find(shortcut => shortcut.key === key);
}

describe("registerDevShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    output = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.join(" "));
    });

    isSupported.mockReturnValue(true);
    restartDevServer.mockResolvedValue(true);
    list.mockReturnValue([]);
  });

  it("arms the standing shortcuts and prints the hint", () => {
    registerDevShortcuts(devServer);

    expect(register.mock.calls.map(([shortcut]) => shortcut.key)).toEqual([
      "r",
      "c",
      "q",
      "h",
    ]);
    expect(printed()).toContain("for shortcuts");
  });

  it("does not offer the update key — the notice owns that one", () => {
    registerDevShortcuts(devServer);

    expect(armed("u")).toBeUndefined();
  });

  it("touches nothing without an interactive terminal", () => {
    isSupported.mockReturnValue(false);

    registerDevShortcuts(devServer);

    expect(register).not.toHaveBeenCalled();
    expect(printed()).toBe("");
  });

  it("restarts on r", async () => {
    registerDevShortcuts(devServer);

    await armed("r")?.handler();

    expect(restartDevServer).toHaveBeenCalledWith(devServer);
    expect(resume).not.toHaveBeenCalled();
  });

  it("takes the terminal back when the restart could not start", async () => {
    restartDevServer.mockResolvedValue(false);

    registerDevShortcuts(devServer);

    await armed("r")?.handler();

    expect(resume).toHaveBeenCalledOnce();
  });

  it("shuts down and exits on q", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    registerDevShortcuts(devServer);

    await armed("q")?.handler();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits non-zero when the shutdown behind q fails", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    shutdown.mockRejectedValueOnce(new Error("connector hung"));

    registerDevShortcuts(devServer);

    await armed("q")?.handler();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("lists whatever is armed right now on h, including a late-armed u", () => {
    registerDevShortcuts(devServer);

    list.mockReturnValue([
      { key: "r", description: "restart the server", handler: vi.fn() },
      { key: "u", description: "update @warlock.js packages and restart", handler: vi.fn() },
    ]);

    armed("h")?.handler();

    expect(printed()).toContain("Shortcuts");
    expect(printed()).toContain("restart the server");
    expect(printed()).toContain("update @warlock.js packages and restart");
    expect(printed()).toContain("Ctrl+C");
  });

  it("clears the console on c", () => {
    const clear = vi.spyOn(console, "clear").mockImplementation(() => {});

    registerDevShortcuts(devServer);

    armed("c")?.handler();

    expect(clear).toHaveBeenCalledOnce();
  });
});
