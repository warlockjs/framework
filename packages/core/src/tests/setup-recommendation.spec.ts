import { describe, expect, it } from "vitest";
import { recommendWorkerLifetime } from "./setup-recommendation";

describe("recommendWorkerLifetime", () => {
  const dominated = { files: 10, bootstraps: 10, setupMs: 9000, bodyMs: 1000 };

  it("recommends worker lifetime when per-file setup dominates", () => {
    const advice = recommendWorkerLifetime(dominated);
    expect(advice).toContain("90%");
    expect(advice).toContain('tests.lifetime: "worker"');
    expect(advice).toContain("tests.resetDatabase");
  });

  it.each([
    ["too few files", { ...dominated, files: 3, bootstraps: 3 }],
    ["worker lifetime already on", { ...dominated, bootstraps: 2 }],
    ["tests dominate", { ...dominated, setupMs: 500, bodyMs: 5000 }],
    ["nothing measured", { ...dominated, setupMs: 0, bodyMs: 0 }],
  ])("stays silent for %s", (_name, share) => {
    expect(recommendWorkerLifetime(share)).toBeUndefined();
  });
});
