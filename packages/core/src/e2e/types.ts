import type { BrowserPage } from "./page";

export type Command = readonly [executable: string, ...args: string[]];
export type Pattern = string | RegExp;
export type Viewport = { name: string; width: number; height: number; mobile?: boolean };
export const defaultViewports: readonly Viewport[] = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844, mobile: true },
];

export type FixtureContext = {
  /** Disposable copy of the app. All commands run here. */
  directory: string;
  dataRoot: string;
  /** OS-selected ephemeral port, reserved until immediately before app startup. */
  port: number;
  url: string;
  /** Write an actual port here when the app binds port 0 itself. */
  portFile: string;
};
export type AppFixtureOptions = {
  directory?: string;
  /** Optional build, executed inside the disposable copy before start. */
  build?: Command | ((fixture: FixtureContext) => Command);
  /** Defaults to [process.execPath, "dist/app.js"]. Must stay in the foreground. */
  start?: Command | ((fixture: FixtureContext) => Command);
  /** Only these app variables are added to the isolated environment. */
  env?: Record<string, string> | ((fixture: FixtureContext) => Record<string, string>);
  /** Directories prepended to PATH, for fixture-owned fake engines/binaries. */
  path?: string[];
  /** Prepare data/fake binaries in the disposable fixture before build/start. */
  prepare?: (fixture: FixtureContext) => void | Promise<void>;
  /** Additional relative directories to omit when copying app files. */
  exclude?: string[];
  readyPath?: string;
  /** If true, await portFile instead of using the preallocated port. */
  portFromFile?: boolean;
  startupTimeoutMs?: number;
};
export type BrowserOptions = {
  binary?: string;
  /** Additional Chrome flags, e.g. --no-sandbox in a controlled root container. */
  args?: string[];
};
export type NetworkFailure = {
  at: string;
  url: string;
  status?: number;
  errorText?: string;
  canceled?: boolean;
  allowed?: boolean;
};
export type ConsoleEntry = { at: string; level: string; text: string; allowed?: boolean };
export type StepEvidence = {
  name: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed";
  error?: string;
};
export type ProcessEvidence = {
  role: string;
  pid: number;
  childPid?: number;
  command: string[];
  ownerFile: string;
  stopped?: boolean;
};
export type E2EEvidence = {
  schemaVersion: 1;
  startedAt: string;
  durationMs: number;
  status: "running" | "passed" | "failed";
  url?: string;
  steps: StepEvidence[];
  console: ConsoleEntry[];
  networkFailures: NetworkFailure[];
  screenshots: { name: string; file: string; viewport: Viewport }[];
  processes: ProcessEvidence[];
  errors: string[];
};
export type NetworkAllowance = { url: Pattern; status?: number; errorText?: Pattern };
export type E2EContext = FixtureContext & {
  page: BrowserPage;
  evidence: E2EEvidence;
  outputDirectory: string;
  signal: AbortSignal;
  step: <T>(name: string, action: () => Promise<T>) => Promise<T>;
};
export type E2ESpec = {
  app: AppFixtureOptions;
  browser?: BrowserOptions;
  viewports?: readonly Viewport[];
  allowConsoleErrors?: Pattern[];
  allowNetworkFailures?: NetworkAllowance[];
  /** Long-lived HTTP requests excluded from the final network-idle barrier. */
  allowPendingRequests?: Pattern[];
  timeoutMs?: number;
  run: (context: E2EContext) => Promise<void>;
};
export type RunE2EOptions = {
  browser?: string;
  path?: string[];
  outputDirectory?: string;
  signal?: AbortSignal;
};

export function defineE2E(spec: E2ESpec): E2ESpec {
  return spec;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function matches(pattern: Pattern, value: string): boolean {
  // A fresh regexp avoids stateful /g and /y allowlists changing their verdict.
  return typeof pattern === "string"
    ? value.includes(pattern)
    : new RegExp(pattern.source, pattern.flags).test(value);
}
