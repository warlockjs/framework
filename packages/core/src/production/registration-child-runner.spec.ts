import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runRegistrationChild,
  type RegistrationChildProcess,
  type RegistrationChildRunOptions,
} from "./registration-child-runner";

class FakeChild extends EventEmitter {
  public connected = true;
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly send = vi.fn();
  public readonly kill = vi.fn();
  public readonly disconnect = vi.fn(() => {
    this.connected = false;
  });
}

const RESULT = "test:result";

function run(child: FakeChild, overrides: Partial<RegistrationChildRunOptions<{ value: string }>> = {}) {
  return runRegistrationChild<{ value: string }>({
    cwd: "C:/app",
    request: { version: 1, cwd: "C:/app" },
    resultMessageType: RESULT,
    resultNoun: "thing",
    readResult: (message) => {
      if (typeof message.payload !== "string") {
        throw new Error("bad payload");
      }

      return { value: message.payload };
    },
    forkProcess: () => child as unknown as RegistrationChildProcess,
    ...overrides,
  });
}

describe("runRegistrationChild", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("forks with the cwd, sends the request over IPC and resolves the validated result", async () => {
    const child = new FakeChild();
    const fork = vi.fn(() => child as unknown as RegistrationChildProcess);
    const result = run(child, { forkProcess: fork });

    child.stdout.emit("data", Buffer.from("application bootstrap log"));
    child.emit("message", { type: RESULT, payload: "ok" });
    child.emit("close", 0);

    await expect(result).resolves.toEqual({ value: "ok" });
    expect(fork).toHaveBeenCalledWith("<injected-route-registration-child>", { cwd: "C:/app" });
    expect(child.send).toHaveBeenCalledWith({ version: 1, cwd: "C:/app" });
    expect(child.disconnect).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses an explicit child entry instead of resolving a compiled one", async () => {
    const child = new FakeChild();
    const fork = vi.fn(() => child as unknown as RegistrationChildProcess);
    const result = run(child, { forkProcess: fork, childEntry: "custom-child.mjs" });

    child.emit("message", { type: RESULT, payload: "ok" });
    child.emit("close", 0);
    await result;

    expect(fork).toHaveBeenCalledWith("custom-child.mjs", { cwd: "C:/app" });
  });

  it("rejects a result the caller refuses and cleans up its child", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.emit("message", { type: RESULT, payload: 42 });

    await expect(result).rejects.toThrow("bad payload");
    expect(child.disconnect).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects a second result message, naming the result noun", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.emit("message", { type: RESULT, payload: "one" });
    child.emit("message", { type: RESULT, payload: "two" });

    await expect(result).rejects.toThrow("Route registration child sent more than one thing.");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects an explicit child error message with the child's text", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.emit("message", { type: "route-registration:error", message: "route import failed" });

    await expect(result).rejects.toThrow("Route registration child failed: route import failed");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("ignores messages of other types", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.emit("message", { type: "something:else", payload: "no" });
    child.emit("message", "plain string");
    child.emit("message", null);
    child.emit("message", { type: RESULT, payload: "yes" });
    child.emit("close", 0);

    await expect(result).resolves.toEqual({ value: "yes" });
  });

  it("rejects when the child exits without a result and attaches its output", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.stdout.emit("data", Buffer.from("some stdout"));
    child.stderr.emit("data", Buffer.from("some stderr"));
    child.emit("close", 3);

    await expect(result).rejects.toThrow(
      /Route registration child exited 3 without a valid thing\.\nChild stdout:\nsome stdout\nChild stderr:\nsome stderr/,
    );
  });

  it("rejects when the child exits non-zero even after sending a result", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.emit("message", { type: RESULT, payload: "ok" });
    child.emit("close", 1);

    await expect(result).rejects.toThrow("exited 1 without a valid thing");
  });

  it("caps the diagnostics it keeps", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.stderr.emit("data", Buffer.alloc(40_000, "x"));
    child.emit("close", 1);

    const error = await result.catch((caught: Error) => caught);

    expect((error as Error).message.length).toBeLessThan(17_500);
  });

  it("reports a child that could not start", async () => {
    const child = new FakeChild();
    const result = run(child);

    child.emit("error", new Error("spawn EACCES"));

    await expect(result).rejects.toThrow("Could not start route registration child: spawn EACCES");
  });

  it("times out, naming the module that was still loading", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const result = run(child, { timeoutMs: 25 });

    child.emit("message", { type: "route-registration:progress", module: "src/routes/users.ts" });
    const assertion = expect(result).rejects.toThrow(
      "Route registration child timed out after 25ms while registering src/routes/users.ts.",
    );

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects a child without an IPC send channel", async () => {
    const child = new FakeChild();

    Object.defineProperty(child, "send", { value: undefined });

    await expect(run(child)).rejects.toThrow("did not provide an IPC send channel");
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
