import { describe, expect, it } from "vitest";
import { ToolExecutionError } from "@warlock.js/ai";
import { createMockBackend } from "../backends/mock";
import { WorkspacePolicyError } from "../errors";
import { createOps } from "../ops";
import type { WorkspacePolicy } from "../contracts";
import { makeRunTestsTool, type MakeRunTestsToolOptions } from "./run-tests";
import { causeOf } from "./test-support";

/** Policy that allows only `npm`; everything else is fail-closed. */
const policy: WorkspacePolicy = {
  cwd: "/srv/app",
  shell: { allow: ["npm"] },
};

/**
 * Build a `run_tests` tool over a mock backend whose `exec` is scripted by
 * exact command line, so every assertion is hermetic and disk-free.
 */
function makeTool(
  commands: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>,
  options?: MakeRunTestsToolOptions,
) {
  const backend = createMockBackend({ files: {}, commands });
  const ops = createOps(backend, policy);

  return makeRunTestsTool(ops, options);
}

describe("makeRunTestsTool", () => {
  it("names the tool `run_tests` by default and accepts a name override", () => {
    const ops = createOps(createMockBackend(), policy);

    expect(makeRunTestsTool(ops).name).toBe("run_tests");
    expect(makeRunTestsTool(ops, { name: "test" }).name).toBe("test");
  });

  it("runs the default `npm test` command on a no-argument call", async () => {
    const runTests = makeTool({ "npm test": { exitCode: 0, stdout: "12 passing" } });

    const { data, error } = await runTests.invoke({});

    expect(error).toBeUndefined();
    expect(data?.exitCode).toBe(0);
    expect(data?.stdout).toBe("12 passing");
  });

  it("appends the pattern to the base command when supplied", async () => {
    const runTests = makeTool({ "npm test cart-total": { exitCode: 0, stdout: "1 passing" } });

    const { data, error } = await runTests.invoke({ pattern: "cart-total" });

    expect(error).toBeUndefined();
    expect(data?.stdout).toBe("1 passing");
  });

  it("honors a custom base command", async () => {
    const runTests = makeTool(
      { "npm run test:unit": { exitCode: 0, stdout: "unit ok" } },
      { command: "npm run test:unit" },
    );

    const { data, error } = await runTests.invoke({});

    expect(error).toBeUndefined();
    expect(data?.stdout).toBe("unit ok");
  });

  it("surfaces failing tests (non-zero exit) as data, not an error", async () => {
    const runTests = makeTool({ "npm test": { exitCode: 1, stderr: "1 failing" } });

    const { data, error } = await runTests.invoke({});

    expect(error).toBeUndefined();
    expect(data?.exitCode).toBe(1);
    expect(data?.stderr).toBe("1 failing");
  });

  it("returns an error when the resolved test command is denied by policy", async () => {
    // `command: "pytest"` resolves to a `pytest` executable, which is not
    // in the `npm`-only allow list, so the ops layer rejects it.
    const runTests = makeTool({ pytest: { exitCode: 0 } }, { command: "pytest" });

    const { data, error } = await runTests.invoke({});

    expect(data).toBeUndefined();
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect(causeOf(error)).toBeInstanceOf(WorkspacePolicyError);
    expect((causeOf(error) as WorkspacePolicyError).type).toBe("denied-command");
  });

  it("rejects a non-string pattern with a validation error", async () => {
    const runTests = makeTool({});

    const { data, error } = await runTests.invoke({ pattern: 123 });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
  });
});
