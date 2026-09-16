import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  displayCommandError,
  displayCommandSuccess,
  displayExecutingCommand,
} from "../../../src/cli/cli-commands.utils";

/**
 * Every command prints a completion banner. Some commands print a MACHINE
 * PAYLOAD — `warlock routes --json` is documented as emitting "the normalized
 * rows as JSON for piping into scripts/CI". While the banner went to stdout,
 * that command's actual stdout was:
 *
 * ```
 * []
 *
 *   ✔ routes completed successfully (696ms)
 * ```
 *
 * which is not JSON, so nothing could pipe it. The seam read as machine-usable
 * and was not. These assertions pin the split: stdout carries the payload,
 * stderr carries the chrome.
 */
describe("command banners never contaminate stdout, because stdout is where a machine payload goes", () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.join(" "));
    });
  });

  it("writes the success banner to stderr and NOTHING to stdout", () => {
    displayCommandSuccess("routes", 696);

    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("completed successfully");
    expect(stderr.join("\n")).toContain("routes");
  });

  it("writes the failure banner to stderr and NOTHING to stdout", () => {
    displayCommandError("routes", new Error("boom"));

    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("failed");
    expect(stderr.join("\n")).toContain("boom");
  });

  it("writes the running header to stderr and NOTHING to stdout", () => {
    displayExecutingCommand("routes");

    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("Running");
    expect(stderr.join("\n")).toContain("routes");
  });

  it("leaves a JSON payload on stdout parseable after banners are printed around it", () => {
    // The exact interleaving `warlock routes --json` produces: the manager
    // prints the running header, the command writes its payload to stdout, the
    // manager writes the completion banner. Parsing stdout must see neither.
    displayExecutingCommand("routes");
    console.log(JSON.stringify([{ method: "GET", path: "/" }]));
    displayCommandSuccess("routes", 12);

    expect(() => JSON.parse(stdout.join("\n"))).not.toThrow();
    expect(JSON.parse(stdout.join("\n"))).toEqual([{ method: "GET", path: "/" }]);
  });
});
