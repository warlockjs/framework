import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { guardianAddress, guardianScript, parseGuardianProof } from "../src/guardian";

it.each(["darwin", "win32"])(
  "keeps the %s guardian gated and proves its environment token without consuming stdin",
  (platform) => {
    const token = "a".repeat(64);
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const listen = vi.fn((_address: string, callback: () => void) => callback());
    const server = { listen, on: vi.fn(), close: vi.fn() };
    let accept: ((socket: EventEmitter) => void) | undefined;
    const createServer = vi.fn((callback: (socket: EventEmitter) => void) => {
      accept = callback;
      return server;
    });
    const exit = vi.fn();
    const kill = vi.fn();
    const env = {
      APP_MODE: "test",
      ...(platform === "win32"
        ? { warlock_process_token: "untrusted", warlock_process_launch: "untrusted" }
        : {}),
      WARLOCK_PROCESS_TOKEN: token,
      WARLOCK_PROCESS_LAUNCH: JSON.stringify(["worker", "argument with spaces", "$(literal)"]),
    };
    runInNewContext(guardianScript, {
      require: (name: string) => {
        if (name === "node:crypto") return { createHmac };
        if (name === "node:net") return { createServer };
        if (name === "node:child_process") return { spawn };
        if (name === "node:fs") return { chmodSync: vi.fn(), unlinkSync: vi.fn() };
        throw new Error(`Unexpected import ${name}`);
      },
      process: { platform, pid: 42, getuid: () => 1000, env, on: vi.fn(), exit, kill },
      console: { error: vi.fn() },
    });
    expect(listen.mock.calls[0]?.[0]).toBe(guardianAddress(platform, 42, 1000));
    expect(spawn).not.toHaveBeenCalled();
    const nonce = "b".repeat(64);
    const sign = (value: string) => createHmac("sha256", token).update(value).digest("hex");
    const request = (value: object) => {
      const socket = Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn(),
      });
      if (!accept) throw new Error("Missing guardian listener");
      accept(socket);
      socket.emit("data", JSON.stringify({ nonce, ...value }) + "\n");
      return socket;
    };
    const probe = request({});
    expect(JSON.parse(String(probe.end.mock.calls[0]?.[0]))).toEqual({
      pid: 42,
      digest: sign(nonce + ":42:true"),
      gated: true,
    });
    request({ resume: "wrong-token" });
    expect(spawn).not.toHaveBeenCalled();
    request({ resume: sign(nonce + ":resume") });
    request({ resume: sign(nonce + ":resume") });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("worker", ["argument with spaces", "$(literal)"], {
      env: { APP_MODE: "test" },
      stdio: "inherit",
      windowsHide: true,
    });
    // Removing workload credentials must not affect the guardian's later proof.
    const after = request({});
    expect(JSON.parse(String(after.end.mock.calls[0]?.[0]))).toEqual({
      pid: 42,
      digest: sign(nonce + ":42:false"),
      gated: false,
    });
    expect(env.WARLOCK_PROCESS_TOKEN).toBe(token);
    child.emit("exit", 7, null);
    expect(exit).toHaveBeenCalledWith(7);
    expect(kill).not.toHaveBeenCalled();
  },
);

it("rejects replayed, mismatched or malformed ownership proofs without exposing the token", () => {
  const token = "a".repeat(64);
  const nonce = "b".repeat(64);
  const digest = createHmac("sha256", token)
    .update(nonce + ":42:true")
    .digest("hex");
  const proof = JSON.stringify({ pid: 42, digest, gated: true });
  expect(proof).not.toContain(token);
  expect(parseGuardianProof(proof, 42, nonce, token)).toEqual({ pid: 42, token, gated: true });
  expect(parseGuardianProof(proof, 42, "c".repeat(64), token)).toBeUndefined();
  expect(parseGuardianProof(proof, 99, nonce, token)).toBeUndefined();
  expect(parseGuardianProof(proof, 42, nonce, "0".repeat(64))).toBeUndefined();
  expect(() => parseGuardianProof("{}", 42, nonce, token)).toThrow(
    "Invalid process ownership response",
  );
});
