import { describe, expect, it } from "vitest";
import { cpuQuotaWorkers, recommendedTestWorkers } from "./test-workers";

describe("CPU quota worker recommendation", () => {
  it("caps 48 visible CPUs at a 12 CPU quota", () => {
    expect(
      recommendedTestWorkers(48, (file) =>
        file === "/proc/self/cgroup" ? "0::/ci/job\n" : "1200000 100000",
      ),
    ).toBe(12);
  });
  it("uses the tightest ancestor quota and affinity", () => {
    const values: Record<string, string> = {
      "/proc/self/cgroup": "0::/ci/job",
      "/sys/fs/cgroup/ci/job/cpu.max": "max 100000",
      "/sys/fs/cgroup/ci/cpu.max": "250000 100000",
      "/sys/fs/cgroup/cpu.max": "1200000 100000",
    };
    expect(recommendedTestWorkers(48, (file) => values[file] ?? "")).toBe(2);
    expect(recommendedTestWorkers(1, (file) => values[file] ?? "")).toBe(1);
  });
  it("handles fractional quotas, unlimited, malformed and missing cgroups", () => {
    expect(cpuQuotaWorkers("50000 100000")).toBe(1);
    for (const value of ["max 100000", "oops", "0 100000", "100000 0"]) {
      expect(cpuQuotaWorkers(value)).toBeUndefined();
    }
    expect(
      recommendedTestWorkers(4, () => {
        throw new Error("not Linux");
      }),
    ).toBe(4);
  });
});
