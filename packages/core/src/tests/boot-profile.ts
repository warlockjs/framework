/**
 * The per-phase boot profile of a test run.
 *
 * Pure and import-free, like `setup-recommendation.ts`: the Vite reporter and
 * the tests share it, and the reporter must not pull the framework in.
 *
 * Each file line the worker prints (`[warlock:test] file=... step=12.00ms ...`)
 * becomes a {@link ProfiledFile}; this module turns a run's worth of them into
 * the phases an app can act on and the slowest files.
 */

/** One test file's setup steps and its own test time, in milliseconds. */
export type ProfiledFile = {
  file: string;
  pid: string;
  steps: Record<string, number>;
};

/**
 * The phases of booting the app for tests, in the order they run.
 *
 * - `config`: environment, config manager, bootstrap, the files orchestrator and
 *   the app's `src/config` files.
 * - `translations`: the locale files the tests load.
 * - `connectors`: `boot()` and `start()` of every connector, listed one by one
 *   (`connector.database`, `connector.web`, ...). The database connector includes
 *   opening the connection and registering models; the web connector includes
 *   creating the Vite dev server.
 * - `fakes`: installing the test fakes.
 * - `routes`: loading the app's modules (`routes.ts`, `main.ts`, events, models)
 *   and scanning routes.
 * - `reset`: the per-file reset of a worker-scoped runtime.
 * - `teardown`: closing the runtime.
 */
export type BootPhase =
  | "config"
  | "translations"
  | "connectors"
  | "fakes"
  | "routes"
  | "reset"
  | "teardown";

const PHASE_OF_STEP: Record<string, BootPhase> = {
  environment: "config",
  config: "config",
  bootstrap: "config",
  orchestrator: "config",
  appConfig: "config",
  locales: "translations",
  connectors: "connectors",
  earlyConnectors: "connectors",
  lateConnectors: "connectors",
  fakes: "fakes",
  appModules: "routes",
  reset: "reset",
  optOutShutdown: "teardown",
  teardown: "teardown",
  shutdown: "teardown",
};

const PHASE_ORDER: BootPhase[] = [
  "config",
  "translations",
  "connectors",
  "fakes",
  "routes",
  "reset",
  "teardown",
];

/** The step that holds the time a file's tests ran, not setup. */
export const BODY_STEP = "body";

/** A step is a per-connector breakdown when it looks like `connector.<name>`. */
export function isConnectorStep(step: string): boolean {
  return step.startsWith("connector.");
}

export type BootProfile = {
  /** Total milliseconds per phase, over every file. */
  phases: Record<BootPhase, number>;
  /** Milliseconds per connector (`boot()` + `start()`), over every file. */
  connectors: Record<string, number>;
  /** Milliseconds the files' tests ran. */
  bodyMs: number;
  /** The slowest files by setup plus test time, slowest first. */
  slowestFiles: Array<{ file: string; pid: string; setupMs: number; bodyMs: number }>;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Group a run's file profiles into phases and rank its slowest files.
 *
 * `connector.<name>` steps overlap the `connectors` step (they are the same time
 * seen per connector), so they feed `connectors` by name only and never add to
 * the phase total twice.
 */
export function buildBootProfile(
  files: readonly ProfiledFile[],
  options: { slowest?: number } = {},
): BootProfile {
  const phases = Object.fromEntries(PHASE_ORDER.map((phase) => [phase, 0])) as Record<
    BootPhase,
    number
  >;
  const connectors: Record<string, number> = {};
  let bodyMs = 0;
  const ranked: BootProfile["slowestFiles"] = [];

  for (const { file, pid, steps } of files) {
    let setupMs = 0;
    let fileBodyMs = 0;

    for (const [step, ms] of Object.entries(steps)) {
      if (step === BODY_STEP) {
        fileBodyMs += ms;
        continue;
      }

      if (isConnectorStep(step)) {
        const name = step.slice("connector.".length);
        connectors[name] = (connectors[name] ?? 0) + ms;
        continue;
      }

      const phase = PHASE_OF_STEP[step];

      if (phase) phases[phase] += ms;
      setupMs += ms;
    }

    bodyMs += fileBodyMs;
    ranked.push({ file, pid, setupMs: round(setupMs), bodyMs: round(fileBodyMs) });
  }

  ranked.sort((a, b) => b.setupMs + b.bodyMs - (a.setupMs + a.bodyMs));

  for (const phase of PHASE_ORDER) phases[phase] = round(phases[phase]);
  for (const name of Object.keys(connectors)) connectors[name] = round(connectors[name] ?? 0);

  return {
    phases,
    connectors,
    bodyMs: round(bodyMs),
    slowestFiles: ranked.slice(0, options.slowest ?? 5),
  };
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

/**
 * The human-readable breakdown: one line of phases (connectors itemised), one
 * line for the HTTP test server when it booted with profiling on, and the
 * slowest files.
 */
export function formatBootProfile(
  profile: BootProfile,
  server?: { steps: Record<string, number> },
): string[] {
  const phases = PHASE_ORDER.map((phase) => `${phase}=${formatMs(profile.phases[phase])}`).join(" ");
  const connectors = Object.entries(profile.connectors)
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => `${name}=${formatMs(ms)}`)
    .join(" ");
  const lines = [
    `[warlock:test] boot phases ${phases} test=${formatMs(profile.bodyMs)}`,
  ];

  if (connectors) lines.push(`[warlock:test] connectors ${connectors}`);

  if (server) {
    const steps = Object.entries(server.steps)
      .map(([step, ms]) => `${step}=${formatMs(ms)}`)
      .join(" ");

    lines.push(`[warlock:test] http server boot ${steps}`);
  }

  if (profile.slowestFiles.length > 0) {
    lines.push("[warlock:test] slowest files");

    for (const entry of profile.slowestFiles) {
      lines.push(
        `  ${formatMs(entry.setupMs + entry.bodyMs)} (setup ${formatMs(entry.setupMs)}, tests ${formatMs(entry.bodyMs)}) ${entry.file}`,
      );
    }
  }

  return lines;
}
