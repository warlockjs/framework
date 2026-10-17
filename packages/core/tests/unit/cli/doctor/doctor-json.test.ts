import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DoctorBootContext,
  DoctorReport,
} from "../../../../src/cli/commands/doctor/check.types";
import { formatReportLines, toDoctorJson } from "../../../../src/cli/commands/doctor/format-report";
import { isWarlockErrorCode } from "../../../../src/errors/error-codes";

/**
 * `warlock doctor --json`: every finding carries its stable `WL` code with the
 * registry's hint, skill and docs link, and stdout carries only the JSON.
 */

const report: DoctorReport = {
  results: [
    { name: "routes", status: "ok", detail: "42 registered" },
    {
      name: "config",
      status: "fail",
      detail: "missing required config section(s): http",
      code: "WL1001",
    },
  ],
  summary: { ok: 1, warn: 0, fail: 1 },
  hasFailures: true,
  exitCode: 1,
};

const hoisted = vi.hoisted(() => ({
  context: {
    booted: true,
    routeModules: 1,
    appRoutes: 0,
    totalRoutes: 0,
    moduleFailures: [],
    modelModules: [],
    connectors: { registered: [], configured: [], booted: [], skipped: [], failures: [] },
  } satisfies DoctorBootContext,
  exit: vi.fn(),
}));

vi.mock("../../../../src/cli/commands/doctor/boot-for-diagnostics", () => ({
  bootForDiagnostics: async () => {
    console.log("processing 3 files...");
    return hoisted.context;
  },
  hasHttpConfig: () => false,
}));

vi.mock("../../../../src/cli/flush-and-exit", () => ({ flushAndExit: hoisted.exit }));

afterEach(() => {
  vi.restoreAllMocks();
  hoisted.exit.mockReset();
});

describe("toDoctorJson", () => {
  it("adds the code, hint, skill and docs of every non-ok finding, and nulls on ok", () => {
    const json = toDoctorJson(report);

    expect(json.schemaVersion).toBe(1);
    expect(json.exitCode).toBe(1);
    expect(json.results[0]).toEqual({
      name: "routes",
      status: "ok",
      detail: "42 registered",
      code: null,
      hint: null,
      skill: null,
      docs: null,
    });
    expect(json.results[1]).toMatchObject({
      code: "WL1001",
      skill: "configure-app",
      docs: "https://warlock.js.org/v/latest/core/cli/error-codes/#wl1001",
    });
    expect(json.results[1]?.hint).toContain("src/config/");
  });

  it("shows the code after the detail in the plain report", () => {
    expect(formatReportLines(report)[1]).toBe(
      "✗ config: missing required config section(s): http [WL1001]",
    );
  });
});

describe("every doctor check verdict", () => {
  it("carries a registered code on each warn/fail result it can produce", async () => {
    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const verdicts = [
      await routesCheck.run({ ...hoisted.context, routeModules: 2 }),
      await routesCheck.run({ ...hoisted.context, booted: false }),
      await routesCheck.run({
        ...hoisted.context,
        moduleFailures: [{ file: "src/app/users/routes.ts", message: "boom" }],
      }),
    ];

    expect(verdicts.map((verdict) => verdict?.code)).toEqual(["WL3005", "WL2002", "WL2001"]);
    expect(verdicts.every((verdict) => isWarlockErrorCode(verdict?.code))).toBe(true);
  });
});

describe("doctor --json", () => {
  it("prints only the JSON report on stdout and exits through the flush", async () => {
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { doctorCommandAction } =
      await import("../../../../src/cli/commands/doctor/doctor-command.action");

    await doctorCommandAction({ args: [], options: { json: true } });

    expect(stdout).toHaveLength(1);

    const parsed = JSON.parse(stdout[0] ?? "") as ReturnType<typeof toDoctorJson>;

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.results.find((result) => result.name === "routes")?.code).toBe("WL3005");
    expect(hoisted.exit).toHaveBeenCalledWith(1);
  });
});
