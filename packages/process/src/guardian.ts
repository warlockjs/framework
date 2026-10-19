import { createHmac, randomBytes } from "node:crypto";
import { connect } from "node:net";
import type { Command, OwnershipProof } from "./platform";
import { launcher } from "./resources";
import type { ProcessLimits } from "./types";

export function guardianAddress(platform: string, pid: number, uid: number): string {
  return platform === "win32"
    ? `\\\\.\\pipe\\warlock-process-${pid}`
    : `/tmp/warlock-process-${uid}-${pid}.sock`;
}

/** A live guardian reads its own environment, never argv, to prove ownership.
 * Node IPC is native-free: https://nodejs.org/api/net.html#ipc-support
 * The stable root PID stays alive for the workload and survives supervisor restarts.
 */
export const guardianScript = String.raw`
const { createServer } = require("node:net");
const { createHmac } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chmodSync, unlinkSync } = require("node:fs");
const token = process.env.WARLOCK_PROCESS_TOKEN;
const address = process.platform === "win32"
  ? "\\\\.\\pipe\\warlock-process-" + process.pid
  : "/tmp/warlock-process-" + process.getuid() + "-" + process.pid + ".sock";
let gated = true;
const finish = (code) => { server.close(); process.exit(code); };
const start = () => {
  if (!gated) return;
  gated = false;
  const [command, ...args] = JSON.parse(process.env.WARLOCK_PROCESS_LAUNCH);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const name = process.platform === "win32" ? key.toUpperCase() : key;
    if (name === "WARLOCK_PROCESS_TOKEN" || name === "WARLOCK_PROCESS_LAUNCH") delete env[key];
  }
  const child = spawn(command, args, { env, stdio: "inherit", windowsHide: true });
  child.on("error", (error) => { console.error(error.message); finish(127); });
  child.on("exit", (code, signal) => {
    if (signal && process.platform !== "win32") process.kill(process.pid, signal);
    else finish(code ?? 1);
  });
};
const server = createServer((socket) => {
  socket.setTimeout(2000, () => socket.destroy());
  socket.on("error", () => {});
  let input = "";
  socket.on("data", (chunk) => {
    input += chunk;
    if (input.length > 1024) { socket.destroy(); return; }
    if (!input.endsWith("\n")) return;
    try {
      const request = JSON.parse(input);
      if (!/^[a-f0-9]{64}$/.test(request.nonce)) { socket.destroy(); return; }
      const sign = (value) => createHmac("sha256", token).update(value).digest("hex");
      if (request.resume === sign(request.nonce + ":resume")) start();
      socket.end(JSON.stringify({ pid: process.pid, digest: sign(request.nonce + ":" + process.pid + ":" + gated), gated }) + "\n");
    } catch { socket.destroy(); }
  });
});
server.on("error", (error) => { console.error(error.message); process.exit(126); });
if (process.platform !== "win32") {
  try { unlinkSync(address); } catch (error) { if (error.code !== "ENOENT") throw error; }
  process.on("exit", () => { try { unlinkSync(address); } catch {} });
}
server.listen(address, () => { if (process.platform !== "win32") chmodSync(address, 0o600); });
`;

export async function guardianProof(
  pid: number,
  resume?: string,
  expectedToken: string | undefined = resume,
): Promise<OwnershipProof | undefined> {
  if (!expectedToken) return undefined;
  const token = expectedToken;
  const nonce = randomBytes(32).toString("hex");
  const sign = (value: string) => createHmac("sha256", token).update(value).digest("hex");
  const address = guardianAddress(process.platform, pid, process.getuid?.() ?? 0);
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    let data = "";
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2000, () => fail(new Error("Process ownership observation timed out")));
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({ nonce, resume: resume ? sign(nonce + ":resume") : undefined }) + "\n",
      ),
    );
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 1024) fail(new Error("Invalid process ownership response"));
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")) resolve(undefined);
      else reject(error);
    });
    socket.on("end", () => {
      try {
        resolve(parseGuardianProof(data, pid, nonce, token));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Malformed observation is an error; an authenticated identity mismatch is unowned. */
export function parseGuardianProof(
  source: string,
  pid: number,
  nonce: string,
  token: string,
): OwnershipProof | undefined {
  const proof: unknown = JSON.parse(source);
  if (
    !proof ||
    typeof proof !== "object" ||
    !("pid" in proof) ||
    typeof proof.pid !== "number" ||
    !("gated" in proof) ||
    typeof proof.gated !== "boolean" ||
    !("digest" in proof) ||
    typeof proof.digest !== "string"
  )
    throw new Error("Invalid process ownership response");
  const expected = createHmac("sha256", token)
    .update(nonce + ":" + pid + ":" + proof.gated)
    .digest("hex");
  if (proof.pid !== pid || proof.digest !== expected) return undefined;
  return { pid, token, gated: proof.gated };
}

/** Pure launch construction, including case-insensitive Windows environment keys. */
export function launchCommand(
  platform: string,
  node: string,
  command: string,
  args: string[],
  limits: ProcessLimits,
  environment: NodeJS.ProcessEnv,
  token: string,
): Omit<Command, "env"> & { env: NodeJS.ProcessEnv } {
  const portable = platform !== "linux";
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        !["WARLOCK_PROCESS_TOKEN", "WARLOCK_PROCESS_LAUNCH"].includes(
          platform === "win32" ? key.toUpperCase() : key,
        ),
    ),
  );
  env.WARLOCK_PROCESS_TOKEN = token;
  if (portable) env.WARLOCK_PROCESS_LAUNCH = JSON.stringify([command, ...args]);
  const executable = portable ? node : command;
  const arguments_ = portable ? ["-e", guardianScript] : args;
  return {
    file: platform === "win32" ? executable : "/bin/sh",
    args:
      platform === "win32"
        ? arguments_
        : ["-c", launcher(limits, platform), "warlock-process", executable, ...arguments_],
    env,
  };
}
