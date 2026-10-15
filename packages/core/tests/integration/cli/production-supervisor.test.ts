import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripAnsi } from "@mongez/copper";

/*
  Captured output is ANSI-stripped before assertion.

  displayProductionStartFailure writes `${colors.bold("warlock start")} failed`, so the
  escape codes land BETWEEN the two words and the literal string "warlock start failed"
  never appears in the raw text. Asserting on the raw stream therefore tested whether
  colour happened to be enabled, not what the operator is told — and colour depends on
  NO_COLOR / FORCE_COLOR and on whether the stream is a TTY.
*/
import { displayMissingReadinessNotice } from "../../../src/cli/cli-commands.utils";
import { superviseProductionProcess } from "../../../src/production/production-supervisor";

const fixture = (name: string) => {
  return path.resolve(__dirname, "../../fixtures/production-supervisor", name);
};

/** Let the async banner render before the streams are inspected. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("superviseProductionProcess", () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(stripAnsi(args.join(" ")));
    });

    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(stripAnsi(args.join(" ")));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the started banner only after the child reports readiness", async () => {
    const result = await superviseProductionProcess({
      nodeArgs: [fixture("ready-then-serving-app.mjs")],
    });
    await flush();

    expect(result).toEqual({ exitCode: 0, ready: true });
    expect(stdout.join("\n")).toContain("production server started");
  });

  it("releases the child once it has signalled — an idle app is free to exit", async () => {
    // `ready-app.mjs` schedules nothing after signalling, so it can only exit if
    // the IPC channel was closed. A held-open channel would hang this test.
    const result = await superviseProductionProcess({ nodeArgs: [fixture("ready-app.mjs")] });

    expect(result).toEqual({ exitCode: 0, ready: true });
  });

  it("fails loudly and non-zero when the bundle cannot resolve a module", async () => {
    const result = await superviseProductionProcess({
      nodeArgs: [fixture("missing-module-app.mjs")],
    });
    await flush();

    expect(result.ready).toBe(false);
    expect(result.exitCode).not.toBe(0);

    // Failure belongs on stderr exactly once. Production launchers commonly
    // merge stdout and stderr, so mirroring it to both streams duplicates every
    // diagnostic line. The non-zero result is the machine-readable failure.
    expect(stderr.join("\n")).toContain("failed");
    expect(stdout.join("\n")).not.toContain("failed");
    expect(
      [...stderr, ...stdout].filter((line) => line.includes("warlock start failed")),
    ).toHaveLength(1);
    expect(stdout.join("\n")).not.toContain("production server started");

    // Node's own ERR_MODULE_NOT_FOUND trace is real output the child wrote
    // before dying, so the summary is allowed to point at it.
    expect(stderr.join("\n")).toContain("cause is printed above");
    expect(stderr.join("\n")).not.toContain("no output was captured");
  });

  it("forces a non-zero exit when the child exits 0 without ever booting", async () => {
    const result = await superviseProductionProcess({
      nodeArgs: [fixture("silent-exit-app.mjs")],
    });
    await flush();

    expect(result).toEqual({ exitCode: 1, ready: false });
    expect(stdout.join("\n")).not.toContain("production server started");

    // `silent-exit-app.mjs` writes nothing to either stream before calling
    // `process.exit(0)`, so claiming "the cause is printed above" would send
    // the developer looking for output that was never there.
    expect(stderr.join("\n")).toContain("no output was captured");
    expect(stderr.join("\n")).not.toContain("cause is printed above");
  });

  it("notes a missing readiness signal on stderr only, never on stdout", async () => {
    // A bundle built before readiness reporting: alive, silent, and healthy —
    // so the note may not appear on the stream a supervisor treats as green.
    const result = await superviseProductionProcess({
      nodeArgs: ["-e", "setTimeout(() => process.exit(0), 200)"],
      readinessNoticeDelayMs: 20,
    });
    await flush();

    expect(result.ready).toBe(false);
    expect(stderr.join("\n")).toContain("no readiness signal");
    expect(stdout.join("\n")).not.toContain("no readiness signal");
  });

  it("does not blame the bundle's age for a boot that simply has not finished", () => {
    // The notice fires for a slow boot and a failing boot too, and cannot tell
    // them apart from an old bundle. An earlier wording asserted the bundle
    // predated readiness reporting, which was flatly wrong while a current
    // bundle was mid-crash and sent the reader after the wrong thing.
    displayMissingReadinessNotice(10_000);

    const notice = stderr.join("\n");

    expect(notice).toContain("still in progress");
    expect(notice).not.toMatch(/the bundle predates/);
  });

  it("never kills or fails a child just for staying silent", async () => {
    // A legitimately slow boot must survive the grace period untouched: absence
    // of a signal is not an error, only an actual exit is. This child outlives
    // the notice by an order of magnitude and still runs to its own completion.
    const startedAt = Date.now();

    const result = await superviseProductionProcess({
      nodeArgs: ["-e", "setTimeout(() => process.exit(0), 300)"],
      readinessNoticeDelayMs: 20,
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    expect(result.ready).toBe(false);
  });
});
