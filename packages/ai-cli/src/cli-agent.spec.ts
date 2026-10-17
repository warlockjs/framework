import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { agent } from "@warlock.js/ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCliAgent, currentHost } from "./cli-agent";
import type { CliEvent } from "./contracts";
import { CliError } from "./errors";
import { cliModel } from "./model/cli-model";
import { fakeAdapter, writeFakeCli } from "./test-support/fake-cli";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

async function collect(events: AsyncIterable<CliEvent>): Promise<CliEvent[]> {
  const seen: CliEvent[] = [];

  for await (const event of events) {
    seen.push(event);
  }

  return seen;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();

  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met in time");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

posixOnly("createCliAgent (real processes, fake CLI)", () => {
  let fake: { dir: string; file: string };

  beforeAll(async () => {
    fake = await writeFakeCli();
  });

  afterAll(async () => {
    await rm(fake.dir, { recursive: true, force: true });
  });

  const hostWith = (env: Record<string, string>) => ({
    ...currentHost(),
    env: { ...process.env, ...env },
  });

  it("streams normalized events and resolves the result", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file));
    const session = await cli.run("hello world");
    const events = await collect(session.events);
    const result = await session.done();

    expect(events.map((event) => event.type)).toEqual([
      "session.started",
      "message",
      "message",
      "message",
      "tool.call",
      "tool.result",
      "message",
      "usage",
      "usage",
      "message",
      "session.ended",
    ]);
    expect(result).toMatchObject({
      status: "completed",
      text: "done:11:argv",
      messages: ["Hello", "Read it."],
      sessionRef: "sess-1",
      exitCode: 0,
      usage: { input: 13, output: 7, total: 20, cachedTokens: 4 },
    });
    // A second consumer replays the whole stream.
    expect(await collect(session.events)).toHaveLength(events.length);
  });

  it("falls back to stdin when the prompt does not fit argv", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file));
    const prompt = "x".repeat(200 * 1024);
    const result = await (await cli.run(prompt)).done();

    expect(result.text).toBe(`done:${prompt.length}:stdin`);
  });

  it("fails closed when --help lacks a flag the run needs", async () => {
    const cli = createCliAgent(
      fakeAdapter(fake.file),
      {},
      hostWith({ FAKE_HELP: "Usage: fake\n  -p, --print\n  --json\n" }),
    );

    expect((await (await cli.run("hi")).done()).status).toBe("completed");

    const error = await cli.run("hi", { model: "big" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ type: "capability", flag: "--model", version: "1.4.2" });
    expect((error as CliError).message).toContain("--model");
    expect((error as CliError).message).toContain("1.4.2");
  });

  it("reports a missing executable", async () => {
    const cli = createCliAgent(fakeAdapter("definitely-not-installed-cli-xyz"));

    await expect(cli.run("hi")).rejects.toMatchObject({ type: "not-found" });
  });

  it("refuses options the adapter cannot honour", async () => {
    const adapter = { ...fakeAdapter(fake.file), effort: false, mcp: false };
    const cli = createCliAgent(adapter);

    await expect(cli.run("hi", { effort: "high" })).rejects.toMatchObject({
      type: "unsupported-option",
    });
    await expect(
      cli.run("hi", { mcp: { docs: { type: "stdio", command: "docs-mcp" } } }),
    ).rejects.toMatchObject({ type: "unsupported-option" });
  });

  it("keeps secrets out of argv: API key via env, private home, managed vars stripped", async () => {
    const cli = createCliAgent(
      fakeAdapter(fake.file),
      { apiKey: "sk-test-123", env: { KEEP_ME: "yes" } },
      hostWith({ FAKE_MODE: "env", FAKE_HOME: "/should/not/leak", OTHER_SECRET: "s3" }),
    );
    const result = await (await cli.run("show env")).done();
    const seen = JSON.parse(result.text) as {
      argv: string[];
      home: string;
      key: string;
      keep: string;
      other: string | null;
    };

    expect(seen.key).toBe("sk-test-123");
    expect(seen.argv.join(" ")).not.toContain("sk-test-123");
    expect(seen.keep).toBe("yes");
    expect(seen.other).toBe("s3");
    expect(seen.home.startsWith(path.join(tmpdir(), "warlock-cli-"))).toBe(true);
    expect(seen.home).not.toBe("/should/not/leak");
    // The private home is removed with the run.
    expect(existsSync(seen.home)).toBe(false);
  });

  it("passes only the minimal environment with inheritEnv: false", async () => {
    const cli = createCliAgent(
      fakeAdapter(fake.file),
      { inheritEnv: false },
      hostWith({ FAKE_MODE: "env", OTHER_SECRET: "s3" }),
    );
    // FAKE_MODE itself is not inherited, so pass it explicitly.
    const result = await (await cli.run("env", { env: { FAKE_MODE: "env" } })).done();

    expect(JSON.parse(result.text)).toMatchObject({ other: null });
  });

  it("writes MCP config as a 0600 file in the run directory, never argv", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file), {}, hostWith({ FAKE_MODE: "mcp" }));
    const result = await (
      await cli.run("mcp", {
        mcp: {
          docs: { type: "stdio", command: "docs-mcp", env: { DOCS_TOKEN: "tok-999" } },
          remote: {
            type: "http",
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer abc" },
          },
        },
      })
    ).done();
    const seen = JSON.parse(result.text) as { file: string; mode: string; content: unknown };

    expect(seen.mode).toBe("600");
    expect(seen.content).toEqual({
      mcpServers: {
        docs: { command: "docs-mcp", args: [], env: { DOCS_TOKEN: "tok-999" } },
        remote: { url: "https://mcp.example.com", headers: { Authorization: "Bearer abc" } },
      },
    });
    expect(existsSync(seen.file)).toBe(false);
  });

  it("maps a non-zero exit to failed with stderr", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file), {}, hostWith({ FAKE_MODE: "fail" }));
    const session = await cli.run("x");
    const events = await collect(session.events);
    const result = await session.done();

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
    expect(result.error).toContain("boom: invalid credentials");
    expect(events.at(-2)).toMatchObject({ type: "error", fatal: true });
  });

  it("treats a fatal stream error as failed even on exit 0", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file), {}, hostWith({ FAKE_MODE: "fatal" }));
    const result = await (await cli.run("x")).done();

    expect(result).toMatchObject({ status: "failed", exitCode: 0, error: "quota exhausted" });
  });

  it("kills the whole process tree on abort", async () => {
    const pidFile = path.join(fake.dir, "grandchild.pid");
    const cli = createCliAgent(
      fakeAdapter(fake.file),
      { killGraceMs: 200 },
      hostWith({ FAKE_MODE: "hang", FAKE_PID_FILE: pidFile }),
    );
    const controller = new AbortController();
    const session = await cli.run("x", { signal: controller.signal });

    await waitFor(() => existsSync(pidFile));
    const grandchild = Number(await readFile(pidFile, "utf8"));

    expect(isAlive(grandchild)).toBe(true);
    controller.abort();

    const result = await session.done();

    expect(result.status).toBe("cancelled");
    await waitFor(() => !isAlive(grandchild));
  });

  it("times out and reaps the tree", async () => {
    const pidFile = path.join(fake.dir, "grandchild-timeout.pid");
    const cli = createCliAgent(
      fakeAdapter(fake.file),
      { killGraceMs: 100 },
      hostWith({ FAKE_MODE: "hang", FAKE_PID_FILE: pidFile }),
    );
    const result = await (await cli.run("x", { timeoutMs: 400 })).done();

    expect(result.status).toBe("timeout");
    const grandchild = Number(await readFile(pidFile, "utf8"));

    await waitFor(() => !isAlive(grandchild));
  });

  it("never signals the old process group once the run has finished", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file), { killGraceMs: 50 });
    const controller = new AbortController();
    const session = await cli.run("x", { signal: controller.signal });
    const result = await session.done();

    expect(result.status).toBe("completed");

    // Record (never send) every signal from here on: the finished run's pid
    // may already belong to an unrelated process.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    try {
      session.cancel();
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }

    expect((await session.done()).status).toBe("completed");
  });

  it("never spawns for an already-aborted signal", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file));
    const controller = new AbortController();

    controller.abort();

    const session = await cli.run("x", { signal: controller.signal, resume: "prev-1" });

    expect(session.pid).toBeUndefined();
    expect(await session.done()).toMatchObject({ status: "cancelled", sessionRef: "prev-1" });
  });

  it("passes resume, model, effort and bypass to the plan", async () => {
    const cli = createCliAgent(
      fakeAdapter(fake.file),
      { permission: "bypass" },
      hostWith({ FAKE_MODE: "env" }),
    );
    const result = await (
      await cli.run("x", { resume: "abc", model: "m1", effort: "high" })
    ).done();
    const seen = JSON.parse(result.text) as { argv: string[] };

    expect(seen.argv).toEqual([
      "--print",
      "--json",
      "--model",
      "m1",
      "--effort",
      "high",
      "--resume",
      "abc",
      "--yolo",
      "x",
    ]);
    expect(result.sessionRef).toBe("abc");
  });

  it("works as an ai.agent model", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file));
    const coder = agent({ model: cliModel(cli, { name: "fake-coder" }) });
    const result = await coder.execute("hello");

    expect(result.error).toBeUndefined();
    expect(result.text).toBe("done:5:argv");
    expect(result.usage.total).toBe(20);
  });

  it("surfaces a failed run as an agent error", async () => {
    const cli = createCliAgent(fakeAdapter(fake.file), {}, hostWith({ FAKE_MODE: "fail" }));
    const coder = agent({ model: cliModel(cli) });
    const result = await coder.execute("hello");

    expect(result.error).toBeDefined();
  });
});
