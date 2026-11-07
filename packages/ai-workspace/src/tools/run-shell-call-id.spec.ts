import { describe, expect, it } from "vitest";
import { createLocalBackend } from "../backends/local";
import type { WorkspaceShellOutputEvent } from "../contracts";
import { createOps } from "../ops";
import { makeRunShellTool } from "./run-shell";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const env = { PATH: process.env.PATH ?? "" };
const command = `node -e "console.log('hello')"`;

describe("run_shell call id", () => {
  it("tags each concurrent call's output with its own call id", async () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const ops = createOps(createLocalBackend(), {
      cwd: process.cwd(),
      shell: { allow: ["node"], env },
      hooks: { onShellOutput: (event) => events.push(event) },
    });
    const runShell = makeRunShellTool(ops);
    const artifacts = {};

    await Promise.all([
      runShell.invoke({ command }, { artifacts, callId: "call-a" }),
      runShell.invoke({ command }, { artifacts, callId: "call-b" }),
    ]);

    expect(events.map((event) => event.callId).sort()).toEqual(["call-a", "call-b"]);
  }, 20_000);

  it("tags a background job's output with its job id and the starting call id", async () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const ops = createOps(createLocalBackend(), {
      cwd: process.cwd(),
      shell: { allow: ["node"], env, background: {} },
      hooks: { onShellOutput: (event) => events.push(event) },
    });
    const runShell = makeRunShellTool(ops, { background: true });

    const started = await runShell.invoke(
      { command, background: true },
      { artifacts: {}, callId: "call-bg" },
    );
    const id = (started.data as { id: string }).id;

    await ops.shellOutput(id, { waitMs: 5_000 });
    await wait(200);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.jobId === id && event.callId === "call-bg")).toBe(true);
  }, 20_000);
});
