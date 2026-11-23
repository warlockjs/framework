import { afterEach, describe, expect, it, vi } from "vitest";
import { command } from "../commands/cli-command";
import type { CommandActionData } from "../commands/types";
import { CLICommandsManager } from "./cli-commands.manager";

class FailingPreloadManager extends CLICommandsManager {
  protected override async loadPreloaders(): Promise<void> {
    throw new Error("config/database.ts: DB_HOST is missing");
  }
}

function build(tolerant: boolean, seen: CommandActionData[]) {
  return command({
    name: "tool",
    preload: { bootstrap: true, tolerant },
    action: (data) => {
      seen.push(data);
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("tolerant preload", () => {
  it("runs the action of a tolerant command and hands it the preload error", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const seen: CommandActionData[] = [];
    const verdict = await new FailingPreloadManager().execute(build(true, seen), {
      args: [],
      options: {},
    });

    expect(verdict).toBe("succeeded");
    expect(exit).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.preloadError?.message).toContain("DB_HOST is missing");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DB_HOST is missing"));
  });

  it("still stops a command that did not ask for it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const seen: CommandActionData[] = [];

    await new FailingPreloadManager().execute(build(false, seen), { args: [], options: {} });

    expect(exit).toHaveBeenCalledWith(1);
  });
});
