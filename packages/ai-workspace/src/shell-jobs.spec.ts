import { describe, expect, it } from "vitest";
import { WorkspaceJobError, WorkspacePolicyError } from "./errors";
import { ShellJobs, type ShellJobSpec } from "./shell-jobs";
import type { WorkspaceOutputStream } from "./contracts";

/** A hand-driven background process: emit output, exit, observe kills. */
function controllable() {
  let emit: (stream: WorkspaceOutputStream, chunk: string) => void = () => {};
  let exit: (exitCode: number) => void = () => {};
  let kills = 0;

  const launch: ShellJobSpec["launch"] = (onOutput) => {
    emit = onOutput;

    const done = new Promise<{ exitCode: number }>((resolve) => {
      exit = (exitCode) => resolve({ exitCode });
    });

    return {
      pid: 4242,
      done,
      kill: () => {
        kills++;
        exit(137);
      },
    };
  };

  return {
    launch,
    emit: (stream: WorkspaceOutputStream, chunk: string) => emit(stream, chunk),
    exit: (code: number) => exit(code),
    get kills() {
      return kills;
    },
  };
}

function spec(overrides: Partial<ShellJobSpec> & Pick<ShellJobSpec, "launch">): ShellJobSpec {
  return { command: "npm run dev", retainBytes: 1_000, maxJobs: 4, ...overrides };
}

describe("ShellJobs", () => {
  it("starts a job, reads its output incrementally by cursor, and reports its exit", async () => {
    const jobs = new ShellJobs();
    const proc = controllable();
    const info = jobs.start(spec({ launch: proc.launch }));

    expect(info).toMatchObject({ id: "job-1", status: "running", exitCode: null, pid: 4242 });

    proc.emit("stdout", "booting\n");
    proc.emit("stderr", "warn\n");

    const first = await jobs.output("job-1");

    expect(first).toMatchObject({
      stdout: "booting\n",
      stderr: "warn\n",
      cursor: 13,
      droppedBytes: 0,
    });

    proc.emit("stdout", "ready\n");

    // Default read: only what came after the last read.
    expect((await jobs.output("job-1")).stdout).toBe("ready\n");
    // An explicit cursor re-reads from there.
    expect((await jobs.output("job-1", { since: 0 })).stdout).toBe("booting\nready\n");

    proc.exit(0);
    await new Promise((resolve) => setImmediate(resolve));

    expect(await jobs.output("job-1")).toMatchObject({ status: "exited", exitCode: 0, stdout: "" });
  });

  it("keeps only the newest retainBytes of output, on character boundaries", async () => {
    const jobs = new ShellJobs();
    const proc = controllable();

    jobs.start(spec({ launch: proc.launch, retainBytes: 10 }));
    proc.emit("stdout", "0123456789");
    proc.emit("stdout", "ééé"); // 6 bytes

    const result = await jobs.output("job-1", { since: 0 });

    expect(Buffer.byteLength(result.stdout + result.stderr, "utf8")).toBeLessThanOrEqual(10);
    expect(result.stdout.endsWith("ééé")).toBe(true);
    expect(result.stdout).not.toContain("�");
    expect(result.droppedBytes).toBe(6);
    expect(result.truncated).toBe(true);
    expect(result.cursor).toBe(16);
  });

  it("waits for new output when asked", async () => {
    const jobs = new ShellJobs();
    const proc = controllable();

    jobs.start(spec({ launch: proc.launch }));
    setTimeout(() => proc.emit("stdout", "late\n"), 20);

    const result = await jobs.output("job-1", { waitMs: 2_000 });

    expect(result.stdout).toBe("late\n");
  });

  it("kills a job and marks it killed", async () => {
    const jobs = new ShellJobs();
    const proc = controllable();

    jobs.start(spec({ launch: proc.launch }));

    const killed = await jobs.kill("job-1");

    expect(proc.kills).toBe(1);
    expect(killed).toMatchObject({ status: "killed", exitCode: 137 });
    // Killing again only reports the state.
    await jobs.kill("job-1");
    expect(proc.kills).toBe(1);
  });

  it("times a job out", async () => {
    const jobs = new ShellJobs();
    const proc = controllable();

    jobs.start(spec({ launch: proc.launch, timeoutMs: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(jobs.list()[0]).toMatchObject({ status: "timed-out" });
  });

  it("enforces maxJobs among running jobs", () => {
    const jobs = new ShellJobs();

    jobs.start(spec({ launch: controllable().launch, maxJobs: 1 }));

    expect(() => jobs.start(spec({ launch: controllable().launch, maxJobs: 1 }))).toThrow(
      WorkspacePolicyError,
    );
  });

  it("rejects an unknown id with WorkspaceJobError", async () => {
    await expect(new ShellJobs().output("job-9")).rejects.toBeInstanceOf(WorkspaceJobError);
    await expect(new ShellJobs().kill("job-9")).rejects.toMatchObject({
      type: "not-found",
      jobId: "job-9",
    });
  });

  it("dispose kills every running job and refuses new ones", async () => {
    const jobs = new ShellJobs();
    const first = controllable();
    const second = controllable();

    jobs.start(spec({ launch: first.launch }));
    jobs.start(spec({ launch: second.launch }));
    await jobs.dispose();

    expect(first.kills).toBe(1);
    expect(second.kills).toBe(1);
    expect(jobs.list().map((job) => job.status)).toEqual(["killed", "killed"]);
    expect(() => jobs.start(spec({ launch: controllable().launch }))).toThrow(/disposed/);
  });
});
