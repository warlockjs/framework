import { describe, expect, it } from "vitest";
import { createLocalBackend } from "./backends/local";
import { createMockBackend } from "./backends/mock";
import { ShellOutputStreamer } from "./hooks/shell-output";
import { createOps } from "./ops";
import type { WorkspaceShellOutputEvent } from "./contracts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const env = { PATH: process.env.PATH ?? "" };

describe("ShellOutputStreamer", () => {
  it("holds an unfinished line until its newline, so a secret split across reads is masked", async () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const streamer = new ShellOutputStreamer(
      {
        onShellOutput: (event) => events.push(event),
        redactShellOutput: (text) => text.replace(/sk-[a-z0-9]+/g, "[key]"),
      },
      { command: "node app" },
      undefined,
    );

    streamer.push("stdout", "token sk-ab");
    streamer.push("stdout", "cd12 done\nnext");
    await wait(80);

    expect(events.map((event) => event.chunk)).toEqual(["token [key] done\n"]);

    streamer.end();

    expect(events.map((event) => event.chunk)).toEqual(["token [key] done\n", "next"]);
  });

  it("masks shell.env values and keeps streams in order and apart", () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const streamer = new ShellOutputStreamer(
      { onShellOutput: (event) => events.push(event) },
      { command: "x", jobId: "job-1" },
      { API_KEY: "supersecretvalue", SHORT: "abc" },
    );

    streamer.push("stderr", "key=supersecretvalue abc\n");
    streamer.end();

    expect(events).toEqual([
      { command: "x", jobId: "job-1", stream: "stderr", chunk: "key=[redacted] abc\n" },
    ]);
  });

  it("merges fast output into few deliveries", async () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const streamer = new ShellOutputStreamer(
      { onShellOutput: (event) => events.push(event) },
      { command: "x" },
      undefined,
    );

    for (let index = 0; index < 200; index++) {
      streamer.push("stdout", `line ${index}\n`);
    }

    streamer.end();

    expect(events.length).toBeLessThanOrEqual(2);
    expect(events.map((event) => event.chunk).join("")).toContain("line 199\n");
  });

  it("never lets a throwing hook or redactor out, and drops the text instead of leaking it", () => {
    const hookThrows = new ShellOutputStreamer(
      {
        onShellOutput: () => {
          throw new Error("boom");
        },
      },
      { command: "x" },
      undefined,
    );
    const seen: string[] = [];
    const redactorThrows = new ShellOutputStreamer(
      {
        onShellOutput: (event) => seen.push(event.chunk),
        redactShellOutput: () => {
          throw new Error("boom");
        },
      },
      { command: "x" },
      undefined,
    );

    hookThrows.push("stdout", "a\n");
    redactorThrows.push("stdout", "secret\n");

    expect(() => hookThrows.end()).not.toThrow();
    expect(() => redactorThrows.end()).not.toThrow();
    expect(seen).toEqual([]);
  });
});

describe("hooks.onShellOutput", () => {
  it("streams a foreground command before its result, and leaves the result unchanged", async () => {
    const script =
      "let i=0;const t=setInterval(()=>{console.log('tick '+(++i));if(i===10){clearInterval(t)}},200)";
    const command = `node -e "${script}"`;
    const run = async (withHook: boolean) => {
      const events: Array<WorkspaceShellOutputEvent & { at: number }> = [];
      const ops = createOps(createLocalBackend(), {
        cwd: process.cwd(),
        shell: { allow: ["node"], env },
        ...(withHook
          ? { hooks: { onShellOutput: (event) => events.push({ ...event, at: Date.now() }) } }
          : {}),
      });
      const result = await ops.exec(command, { callId: "call-1" });

      return { events, result, doneAt: Date.now() };
    };

    const hooked = await run(true);
    const plain = await run(false);

    expect(hooked.events.length).toBeGreaterThanOrEqual(5);
    expect(
      hooked.events.every((event) => event.callId === "call-1" && event.stream === "stdout"),
    ).toBe(true);
    expect(hooked.events[0]!.at).toBeLessThan(hooked.doneAt - 1_000);
    expect(hooked.events.map((event) => event.chunk).join("")).toBe(hooked.result.stdout);
    expect(hooked.result).toEqual(plain.result);
  }, 20_000);

  it("leaves the result identical when the hook throws", async () => {
    const commands = { "npm test": { stdout: "ok\n", stderr: "warn\n", exitCode: 3 } };
    const policy = { cwd: "/srv/app", shell: { allow: ["npm"] } };
    const plain = await createOps(createMockBackend({ commands }), policy).exec("npm test");
    const hooked = await createOps(createMockBackend({ commands }), {
      ...policy,
      hooks: {
        onShellOutput: () => {
          throw new Error("host bug");
        },
      },
    }).exec("npm test");

    expect(hooked).toEqual(plain);
  });

  it("falls back to the final capture for a backend that cannot stream", async () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const ops = createOps(
      createMockBackend({ commands: { "npm test": { stdout: "ok\n", stderr: "warn\n" } } }),
      {
        cwd: "/srv/app",
        shell: { allow: ["npm"] },
        hooks: { onShellOutput: (event) => events.push(event) },
      },
    );

    await ops.exec("npm test");

    expect(events.map((event) => [event.stream, event.chunk])).toEqual([
      ["stdout", "ok\n"],
      ["stderr", "warn\n"],
    ]);
  });

  it("tags a background job's chunks with its id and keeps delivering after the call returns", async () => {
    const events: WorkspaceShellOutputEvent[] = [];
    const ops = createOps(createLocalBackend(), {
      cwd: process.cwd(),
      shell: { allow: ["node"], env, background: {} },
      hooks: { onShellOutput: (event) => events.push(event) },
    });
    const script = "setTimeout(()=>console.log('late line'),300);setTimeout(()=>{},400)";
    const job = await ops.startShell(`node -e "${script}"`);

    expect(events).toEqual([]);

    await ops.shellOutput(job.id, { waitMs: 5_000 });
    await wait(500);

    expect(events.map((event) => [event.jobId, event.chunk])).toEqual([[job.id, "late line\n"]]);
    expect(events[0]!.callId).toBeUndefined();
    await ops.shellKill(job.id);
  }, 20_000);
});
