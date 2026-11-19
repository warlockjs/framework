import { afterEach, describe, expect, it, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";
import {
  commandDisplayName,
  displayCommandSuccess,
  displayExecutingCommand,
} from "./cli-commands.utils";

function capture(run: () => void): string {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  try {
    run();

    return spy.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("command display name", () => {
  it("drops <required> and [optional] placeholders", () => {
    expect(commandDisplayName("scry [file]")).toBe("scry");
    expect(commandDisplayName("grimoire <action> [release]")).toBe("grimoire");
    expect(commandDisplayName("routes")).toBe("routes");
    expect(commandDisplayName("generate.controller <module>/<name>", ["users/list"])).toBe(
      "generate.controller users/list",
    );
  });

  it("appends the values the user passed", () => {
    expect(commandDisplayName("grimoire <action> [release]", ["build"])).toBe("grimoire build");
  });

  it("prints no placeholders in the running and completed lines", () => {
    const running = capture(() => displayExecutingCommand("scry [file]"));
    const done = capture(() => displayCommandSuccess("grimoire <action> [release]", 5, ["build"]));

    expect(running).toContain("scry");
    expect(running).not.toContain("[file]");
    expect(done).toContain("grimoire build");
    expect(stripVTControlCharacters(done)).not.toMatch(/[<[]/);
  });
});
