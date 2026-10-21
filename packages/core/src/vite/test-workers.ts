import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";

/** cgroup v2 cpu.max: quota microseconds / period microseconds; round down to avoid oversubscription. */
export function cpuQuotaWorkers(value: string): number | undefined {
  const [quota, period] = value.trim().split(/\s+/);
  if (quota === "max") return undefined;
  const quotaNumber = Number(quota);
  const periodNumber = Number(period);
  if (
    !Number.isFinite(quotaNumber) ||
    !Number.isFinite(periodNumber) ||
    quotaNumber <= 0 ||
    periodNumber <= 0
  )
    return undefined;
  return Math.max(1, Math.floor(quotaNumber / periodNumber));
}

/** Limit Vitest forks to both CPU affinity and the tightest visible cgroup v2 quota. */
export function recommendedTestWorkers(
  parallelism = availableParallelism(),
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): number {
  let workers = Math.max(1, Math.floor(parallelism));
  const root = "/sys/fs/cgroup";
  let directory = root;
  try {
    const entry = read("/proc/self/cgroup")
      .split("\n")
      .find((line) => line.startsWith("0::"));
    if (entry) directory = path.resolve(root, `.${entry.slice(3)}`);
    if (directory !== root && !directory.startsWith(`${root}/`)) directory = root;
  } catch {
    /* Non-Linux hosts use CPU affinity. */
  }
  for (;;) {
    try {
      const quota = cpuQuotaWorkers(read(path.join(directory, "cpu.max")));
      if (quota !== undefined) workers = Math.min(workers, quota);
    } catch {
      /* Missing/unreadable quotas do not replace the affinity limit. */
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return workers;
}
