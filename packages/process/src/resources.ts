import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProcessLimits } from "./types";

function mountedCgroup(membership: string): string | undefined {
  const mount = "/sys/fs/cgroup";
  const directory = path.resolve(mount, `.${membership}`);
  // A cgroup namespace can report ancestors using /../ components. Never
  // normalize those into writes outside the standard cgroup mount.
  return directory === mount || directory.startsWith(`${mount}/`) ? directory : undefined;
}

export function validateLimits(limits: ProcessLimits, platform: string = process.platform): void {
  for (const [key, value] of Object.entries(limits)) {
    if (
      !["timeoutMs", "memoryBytes", "cpuSeconds", "virtualMemoryBytes"].includes(key) ||
      !Number.isSafeInteger(value) ||
      value <= 0
    )
      throw new Error(`Invalid process limit: ${key}`);
  }
  if (platform !== "linux" && limits.virtualMemoryBytes !== undefined)
    throw new Error("virtualMemoryBytes is supported only on Linux");
  if (platform === "win32" && limits.cpuSeconds !== undefined)
    throw new Error("cpuSeconds is supported only on POSIX platforms");
}

/**
 * POSIX shell applies inherited limits. Linux stops here; macOS execs a gated guardian.
 * Flags/units: Apple's bash-3.2/builtins/ulimit.def and installed Bash manual.
 * https://github.com/apple-oss-distributions/bash/blob/main/bash-3.2/builtins/ulimit.def
 */
export function launcher(limits: ProcessLimits, platform: string = process.platform): string {
  const commands = ["set -e"];
  if (limits.cpuSeconds) commands.push(`ulimit -t ${limits.cpuSeconds}`);
  if (limits.virtualMemoryBytes)
    commands.push(`ulimit -v ${Math.ceil(limits.virtualMemoryBytes / 1024)}`);
  // Linux ignores RLIMIT_RSS; polling remains the fallback resident-memory cap.
  // Darwin's RLIMIT_DATA restricts heap growth, not total resident memory.
  if (limits.memoryBytes)
    commands.push(
      `ulimit -${platform === "darwin" ? "d" : "m"} ${Math.ceil(limits.memoryBytes / 1024)}`,
    );
  if (platform === "linux") commands.push('kill -STOP "$$"');
  commands.push('exec "$@"');
  return commands.join("\n");
}

/** https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html */
export async function attachCgroup(
  pid: number,
  token: string,
  limits: ProcessLimits,
  root?: string,
): Promise<string | undefined> {
  if (process.platform !== "linux") return undefined;
  let directory: string | undefined;
  try {
    const own = (await readFile("/proc/self/cgroup", "utf8"))
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3);
    if (!root && own === undefined) return undefined;
    const parent = root ?? mountedCgroup(own ?? "/");
    if (!parent) return undefined;
    // Do not enable controllers or move the app: delegation belongs to the service manager.
    await readFile(path.join(parent, "cgroup.controllers"), "utf8");
    directory = path.join(parent, `warlock-${token}`);
    await mkdir(directory);
    if (limits.memoryBytes) {
      await writeFile(path.join(directory, "memory.max"), String(limits.memoryBytes));
      await writeFile(path.join(directory, "memory.oom.group"), "1");
    }
    await writeFile(path.join(directory, "cgroup.procs"), String(pid));
    return directory;
  } catch {
    if (directory) await rmdir(directory).catch(() => undefined);
    return undefined;
  }
}

export async function cgroupMemory(directory: string): Promise<{ peak: number; oom: boolean }> {
  const [peak, events] = await Promise.all([
    readFile(path.join(directory, "memory.peak"), "utf8").catch(() => "0"),
    readFile(path.join(directory, "memory.events"), "utf8").catch(() => ""),
  ]);
  return { peak: Number(peak) || 0, oom: Number(/^oom_kill (\d+)/m.exec(events)?.[1] ?? 0) > 0 };
}

/** Only reattach the token-specific cgroup confirmed by the kernel membership file. */
export async function recoveredCgroup(pid: number, token: string): Promise<string | undefined> {
  if (process.platform !== "linux") return undefined;
  let source: string;
  try {
    source = await readFile(`/proc/${pid}/cgroup`, "utf8");
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(String((error as NodeJS.ErrnoException).code)))
      return undefined;
    throw error;
  }
  const membership = source
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  if (!membership || path.basename(membership) !== `warlock-${token}`) return undefined;
  return mountedCgroup(membership);
}

export async function cleanCgroup(directory: string): Promise<void> {
  // This unique cgroup was created for this token, or recovered after identity proof.
  // cgroup.kill also covers descendants that created their own POSIX session.
  await writeFile(path.join(directory, "cgroup.kill"), "1").catch(() => undefined);
  await rmdir(directory).catch(() => undefined);
}
