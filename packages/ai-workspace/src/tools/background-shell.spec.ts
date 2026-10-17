import { describe, expect, it } from "vitest";
import { createMockBackend } from "../backends/mock";
import { WorkspaceJobError, WorkspacePolicyError } from "../errors";
import { createOps } from "../ops";
import type { WorkspacePolicy } from "../contracts";
import { makeRunShellTool } from "./run-shell";
import { makeShellKillTool } from "./shell-kill";
import { makeShellOutputTool } from "./shell-output";
import { causeOf } from "./test-support";

const policy: WorkspacePolicy = {
  cwd: "/srv/app",
  shell: { allow: ["npm"], background: { maxJobs: 2 } },
};

function setup(shellPolicy: WorkspacePolicy = policy) {
  const backend = createMockBackend({
    commands: {
      "npm run dev": { stdout: "listening on 5173\n", running: true },
      "npm run build": { stdout: "built\n", exitCode: 0 },
    },
  });
  const ops = createOps(backend, shellPolicy);

  return {
    ops,
    runShell: makeRunShellTool(ops, { background: true }),
    shellOutput: makeShellOutputTool(ops),
    shellKill: makeShellKillTool(ops),
  };
}

describe("background run_shell + shell_output + shell_kill", () => {
  it("starts a background command, reads its output and kills it", async () => {
    const { runShell, shellOutput, shellKill } = setup();

    const started = await runShell.invoke({ command: "npm run dev", background: true });

    expect(started.error).toBeUndefined();
    expect(started.data).toMatchObject({ background: true, id: "job-1", status: "running" });

    const output = await shellOutput.invoke({ id: "job-1" });

    expect(output.data).toMatchObject({ stdout: "listening on 5173\n", status: "running" });

    const killed = await shellKill.invoke({ id: "job-1" });

    expect(killed.data).toMatchObject({ status: "killed", exitCode: 137 });
  });

  it("reports a background command that exits on its own", async () => {
    const { ops, runShell } = setup();

    await runShell.invoke({ command: "npm run build", background: true });
    await new Promise((resolve) => setImmediate(resolve));

    expect(ops.listShells()[0]).toMatchObject({ status: "exited", exitCode: 0 });
  });

  it("still checks the command against the policy", async () => {
    const { runShell } = setup();
    const { error } = await runShell.invoke({ command: "rm -rf /", background: true });

    expect(causeOf(error)).toMatchObject({ type: "denied-command", reason: "not-allowed" });
  });

  it("enforces background.maxJobs", async () => {
    const { runShell } = setup();

    await runShell.invoke({ command: "npm run dev", background: true });
    await runShell.invoke({ command: "npm run dev", background: true });

    const third = await runShell.invoke({ command: "npm run dev", background: true });

    expect(causeOf(third.error)).toBeInstanceOf(WorkspacePolicyError);
    expect((causeOf(third.error) as Error).message).toMatch(/limit is 2/);
  });

  it("refuses background commands when the policy does not enable them", async () => {
    const { ops } = setup({ cwd: "/srv/app", shell: { allow: ["npm"] } });
    const withFlag = makeRunShellTool(ops, { background: true });
    const withoutFlag = makeRunShellTool(ops);

    for (const tool of [withFlag, withoutFlag]) {
      const { error } = await tool.invoke({ command: "npm run dev", background: true });

      expect(causeOf(error)).toMatchObject({ reason: "not-allowed" });
    }
  });

  it("reports an unknown id as WorkspaceJobError", async () => {
    const { shellOutput, shellKill } = setup();

    expect(causeOf((await shellOutput.invoke({ id: "job-7" })).error)).toBeInstanceOf(
      WorkspaceJobError,
    );
    expect(causeOf((await shellKill.invoke({ id: "job-7" })).error)).toBeInstanceOf(
      WorkspaceJobError,
    );
  });

  it("dispose kills running background commands and refuses new commands", async () => {
    const { ops, runShell } = setup();

    await runShell.invoke({ command: "npm run dev", background: true });
    await ops.dispose();

    expect(ops.listShells()[0]).toMatchObject({ status: "killed" });
    await expect(ops.exec("npm run build")).rejects.toThrow(/disposed/);
    await expect(ops.startShell("npm run dev")).rejects.toThrow(/disposed/);
  });

  it("only mentions background in the description and schema when enabled", () => {
    const { ops } = setup();
    const plain = makeRunShellTool(ops);
    const background = makeRunShellTool(ops, { background: true });
    const schemaOf = (tool: { input?: unknown }) =>
      (tool.input as { jsonSchema: { properties: Record<string, unknown> } }).jsonSchema;

    expect(plain.description).not.toMatch(/background/);
    expect(background.description).toMatch(/background: true/);
    expect(schemaOf(plain).properties).not.toHaveProperty("background");
    expect(schemaOf(background).properties).toHaveProperty("background");
  });
});
