import { describe, expect, it, vi } from "vitest";

const config = {
  isLoaded: true,
  load: vi.fn(async () => undefined),
  get: vi.fn(),
};

vi.mock("../warlock-config/warlock-config.manager", () => ({ warlockConfigManager: config }));

const { CLICommandsManager } = await import("./cli-commands.manager");
const { command } = await import("../commands/cli-command");

class TestManager extends CLICommandsManager {
  public loadPlugins() {
    return this.loadPluginsCommands();
  }
}

describe("cli.commands entries", () => {
  it("registers every command of a nested array", async () => {
    const a = command({ name: "plugin-a", action: () => undefined });
    const b = command({ name: "plugin-b", action: () => undefined });
    const c = command({ name: "plugin-c", action: () => undefined });
    config.get.mockReturnValue({ commands: [a, [b, c]] });

    const manager = new TestManager();
    await manager.loadPlugins();

    expect(manager.commands.map((item) => item.name)).toEqual(
      expect.arrayContaining(["plugin-a", "plugin-b", "plugin-c"]),
    );
    expect(b.commandSource).toBe("plugin");
  });
});
