import { stripAnsi } from "@mongez/copper";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayProductionStartFailure } from "../../../src/cli/cli-commands.utils";

/**
 * `displayProductionStartFailure` is what `superviseProductionProcess` calls
 * once it knows a boot failed. These specs isolate the message itself from
 * the child-spawning machinery around it (covered separately in
 * `tests/integration/cli/production-supervisor.test.ts`) so the "cause is
 * printed above" gate can be asserted directly against `causeWasCaptured`
 * without spawning anything.
 */
describe("displayProductionStartFailure", () => {
  let stderr: string[];

  beforeEach(() => {
    stderr = [];

    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(stripAnsi(args.join(" ")));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims the cause is printed above only when one was actually captured", () => {
    displayProductionStartFailure(1, true);

    const output = stderr.join("\n");

    expect(output).toContain("cause is printed above");
    expect(output).not.toContain("no output was captured");
  });

  it("never claims a cause is printed above when none was captured", () => {
    displayProductionStartFailure(1, false);

    const output = stderr.join("\n");

    expect(output).not.toContain("cause is printed above");
    expect(output).toContain("no output was captured");
  });

  it("always reports the exit code and the boot-failed headline regardless of causeWasCaptured", () => {
    displayProductionStartFailure(42, false);

    const output = stderr.join("\n");

    expect(output).toContain("never finished booting");
    expect(output).toContain("exited with code 42");
  });
});
