import { performance } from "node:perf_hooks";

export type TestWorkerConfiguration = { pool: string; watch: boolean; isolate: boolean };
export type TestSetupProfile = { file: string; steps: Record<string, number> };

type RuntimeScope = {
  worker?: TestWorkerConfiguration;
  cleanupRegistered?: boolean;
  lifetime: "file" | "worker";
  fileOpen: boolean;
  boundary?: Promise<void>;
  bootstraps: number;
  files: number;
  summaryPrinted?: boolean;
  shutdownMs?: number;
  shutdown?: () => Promise<void>;
  profiles: TestSetupProfile[];
  profile?: TestSetupProfile;
  unitConfig?: Promise<void>;
  mode?: "unit" | "integration";
};
const KEY = Symbol.for("@warlock.js/core:tests:runtime-scope");

export function testRuntimeScope(): RuntimeScope {
  const host = globalThis as typeof globalThis & { [KEY]?: RuntimeScope };
  if (host[KEY]) return host[KEY];
  const scope: RuntimeScope = {
    lifetime: "file",
    fileOpen: false,
    bootstraps: 0,
    files: 0,
    profiles: [],
  };
  host[KEY] = scope;
  process.once("exit", () => printTestSummary(scope));
  return scope;
}

/** Called by a Vitest runner, whose cleanup callback is awaited before worker exit. */
export function configureTestWorker(
  configuration: TestWorkerConfiguration,
  onCleanup: (cleanup: () => Promise<void>) => void,
): void {
  const scope = testRuntimeScope();
  scope.worker = configuration;
  if (scope.cleanupRegistered) return;
  scope.cleanupRegistered = true;
  onCleanup(async () => {
    try {
      const shutdown = scope.shutdown;
      scope.shutdown = undefined;
      await shutdown?.();
    } finally {
      printTestSummary(scope);
    }
  });
}

export function selectTestLifetime(value: unknown): "file" | "worker" {
  if (value === undefined || value === null || value === "file") return "file";
  if (value !== "worker") throw new Error('tests.lifetime must be "file" or "worker".');
  const worker = testRuntimeScope().worker;
  if (!worker || worker.pool !== "forks" || worker.watch || worker.isolate) {
    throw new Error(
      'tests.lifetime: "worker" requires the Warlock test runner, pool: "forks", isolate: false and vitest run (watch is unsupported).',
    );
  }
  return "worker";
}

/** Process-local counts; aggregate bootstraps across workers when measuring a run. */
export function getTestRuntimeStats(): { bootstraps: number; files: number } {
  const scope = testRuntimeScope();
  return { bootstraps: scope.bootstraps, files: scope.files };
}

export async function timeTestStep<T>(step: string, run: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    const profile = testRuntimeScope().profile;
    if (profile) profile.steps[step] = (profile.steps[step] ?? 0) + performance.now() - started;
  }
}

function formatSteps(steps: Record<string, number>): string {
  return Object.entries(steps)
    .map(([step, ms]) => `${step}=${ms.toFixed(2)}ms`)
    .join(" ");
}

export function finishTestProfile(): void {
  const scope = testRuntimeScope();
  if (!scope.profile) return;
  console.info(
    `[warlock:test] file=${JSON.stringify(scope.profile.file)} pid=${process.pid} ${formatSteps(scope.profile.steps)}`,
  );
  scope.profiles.push(scope.profile);
  scope.profile = undefined;
}

function printTestSummary(scope: RuntimeScope): void {
  if (!scope.profiles.length || scope.summaryPrinted) return;
  scope.summaryPrinted = true;
  const totals: Record<string, number> = {};
  for (const profile of scope.profiles) {
    for (const [step, ms] of Object.entries(profile.steps)) totals[step] = (totals[step] ?? 0) + ms;
  }
  if (scope.shutdownMs !== undefined) totals.shutdown = scope.shutdownMs;
  console.info(
    `[warlock:test] summary pid=${process.pid} files=${scope.files} bootstraps=${scope.bootstraps} ${formatSteps(totals)}`,
  );
}
