import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckReport } from "../../../src/tooling/check/check-report.types";
import { createProblem } from "../../../src/tooling/problem";

/**
 * `warlock check` and `warlock typecheck`: definitions, `--json` printing only
 * the report, the exit code taken from the report, and the problem lines.
 */

const problem = createProblem({
  code: "WL7101",
  source: "typescript",
  message: "Type 'string' is not assignable to type 'number'.",
  file: "src/app/posts/a.ts",
  line: 3,
  column: 7,
  rule: "TS2322",
});

const report: CheckReport = {
  schemaVersion: 1,
  ok: false,
  exitCode: 1,
  changed: true,
  files: ["src/app/posts/a.ts"],
  steps: [
    { name: "typecheck", status: "failed", durationMs: 4, detail: "1 file(s) checked in 4ms" },
  ],
  problems: [problem],
  summary: { errors: 1, warnings: 0, code: 1, environment: 0 },
};

const hoisted = vi.hoisted(() => ({
  runCheck: vi.fn(),
  exit: vi.fn(),
  runTypecheck: vi.fn(),
}));

vi.mock("../../../src/tooling/check/run-check", () => ({ runCheck: hoisted.runCheck }));
vi.mock("../../../src/cli/flush-and-exit", () => ({ flushAndExit: hoisted.exit }));
vi.mock("../../../src/tooling/typecheck/run-typecheck", () => ({
  runTypecheck: hoisted.runTypecheck,
}));

function captureStdout(): string[] {
  const lines: string[] = [];

  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });

  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  hoisted.runCheck.mockReset();
  hoisted.exit.mockReset();
  hoisted.runTypecheck.mockReset();
});

describe("warlock check", () => {
  it("is a framework command without preload, with the documented options", async () => {
    const { checkCommand } = await import("../../../src/cli/commands/check.command");
    const { typecheckCommand } = await import("../../../src/cli/commands/typecheck.command");
    const { frameworkCommands } = await import("../../../src/cli/framework-cli-commands");

    expect(frameworkCommands).toEqual(expect.arrayContaining([checkCommand, typecheckCommand]));
    expect(checkCommand.commandPreload).toBeUndefined();
    expect(typecheckCommand.commandPreload).toBeUndefined();
    expect(checkCommand.commandOptions.map((option) => option.name)).toEqual([
      "lint",
      "changed",
      "base",
      "skip",
      "project",
      "json",
    ]);
    expect(typecheckCommand.commandOptions.map((option) => option.name)).toEqual([
      "changed",
      "base",
      "project",
      "json",
    ]);
  }, 60_000);

  it("prints exactly the report under --json and exits with its code", async () => {
    hoisted.runCheck.mockResolvedValue(report);

    const stdout = captureStdout();
    const { checkCommand } = await import("../../../src/cli/commands/check.command");

    await checkCommand.execute({
      args: [],
      options: { json: true, base: "main", skip: "lint,tests" },
    });

    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? "")).toEqual(report);
    expect(hoisted.runCheck).toHaveBeenCalledWith(
      expect.objectContaining({ changed: true, base: "main", skip: ["lint", "tests"] }),
    );
    expect(hoisted.exit).toHaveBeenCalledWith(1);
  });

  it("prints one line per problem with its hint, then the steps", async () => {
    hoisted.runCheck.mockResolvedValue(report);

    const stdout = captureStdout();
    const { checkCommand } = await import("../../../src/cli/commands/check.command");

    await checkCommand.execute({ args: [], options: {} });

    expect(stdout.join("\n")).toContain(
      "src/app/posts/a.ts:3:7  WL7101  Type 'string' is not assignable to type 'number'. (TS2322)",
    );
    expect(stdout.join("\n")).toContain("typecheck    failed — 1 file(s) checked in 4ms");
    expect(stdout.at(-1)).toBe("1 error(s) in the code (exit 1)");
  });

  it("does not exit when the report is clean", async () => {
    hoisted.runCheck.mockResolvedValue({
      ...report,
      ok: true,
      exitCode: 0,
      problems: [],
      summary: { errors: 0, warnings: 0, code: 0, environment: 0 },
    });
    captureStdout();

    const { checkCommand } = await import("../../../src/cli/commands/check.command");

    await checkCommand.execute({ args: [], options: { json: true } });

    expect(hoisted.exit).not.toHaveBeenCalled();
  });

  it("rejects the removed ESLint selection before checks run", async () => {
    const { checkCommand } = await import("../../../src/cli/commands/check.command");
    await expect(checkCommand.execute({ args: [], options: { lint: "eslint" } })).rejects.toThrow(
      /removed in 5\.34\.0.*Oxlint\/Oxfmt/,
    );
    expect(hoisted.runCheck).not.toHaveBeenCalled();
  });

  it("refuses an unknown --skip step", async () => {
    const { checkCommand } = await import("../../../src/cli/commands/check.command");

    await expect(checkCommand.execute({ args: [], options: { skip: "docs" } })).rejects.toThrow(
      "Unknown check step(s): docs",
    );
    expect(hoisted.runCheck).not.toHaveBeenCalled();
  });
});

describe("warlock typecheck", () => {
  it("prints the result under --json and exits 1 on a type error", async () => {
    hoisted.runTypecheck.mockReturnValue({
      ok: false,
      mode: "program",
      files: null,
      checkedFiles: 3,
      problems: [problem],
      durationMs: 9,
      buildInfoFile: null,
    });

    const stdout = captureStdout();
    const { typecheckCommand } = await import("../../../src/cli/commands/typecheck.command");

    await typecheckCommand.execute({
      args: [],
      options: { json: true, project: "tsconfig.app.json" },
    });

    expect(JSON.parse(stdout.join("\n"))).toMatchObject({
      checkedFiles: 3,
      problems: [{ code: "WL7101" }],
    });
    expect(hoisted.runTypecheck).toHaveBeenCalledWith(
      expect.objectContaining({ project: "tsconfig.app.json" }),
    );
    expect(hoisted.exit).toHaveBeenCalledWith(1);
  });
});
