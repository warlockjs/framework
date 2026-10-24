/**
 * One named command in the release gate. Checks run in order and the gate
 * stops at the first one that fails.
 */
export type ReleaseCheck = {
  /** Name shown in the report and recorded in the manifest */
  name: string;
  /** Shell command, run inside the candidate's frozen source */
  command: string;
  /** Kill the check after this many milliseconds. @default 1_800_000 */
  timeoutMs?: number;
};

/**
 * Release settings, read from the `release` key of `warlock.config.ts`.
 *
 * Every field is optional; the defaults describe a plain Warlock app that
 * builds into `dist`.
 */
export type ReleaseConfig = {
  /**
   * Base directory for releases and the `current` / `previous` pointers,
   * relative to the project root.
   *
   * @default ".warlock"
   */
  directory?: string;
  /**
   * Build output directory, relative to the candidate's source.
   *
   * @default "dist"
   */
  distDir?: string;
  /**
   * Extra files or directories (relative to the candidate's source) copied
   * next to the build output when staging. `package.json` and the lockfile
   * are always copied.
   */
  include?: string[];
  /**
   * Link the project's `node_modules` into the frozen source so gate checks
   * and the build can run without a second install.
   *
   * @default true
   */
  linkNodeModules?: boolean;
  /** The ordered gate checks. Replaces the defaults when set. */
  gate?: { checks?: ReleaseCheck[] };
  /** Migration proof settings */
  migrations?: {
    /**
     * Named targets. `--target <name>` applies the target's `env` to this
     * process before the database connects, so the proof runs against that
     * database instead of the one the local environment points to.
     */
    targets?: Record<string, { env?: Record<string, string> }>;
    /**
     * Migration names that must be the ones executed, in order. Defaults to
     * the pending set computed before the run.
     */
    expected?: string[];
    /** Tables or collections that must exist after the run. */
    expectedTables?: string[];
  };
  /**
   * Command that makes the running application pick up the new release.
   * Warlock never restarts anything on its own: leave it unset and activation
   * only switches the pointer.
   *
   * It runs through the shell with `WARLOCK_RELEASE_ID`,
   * `WARLOCK_RELEASE_DIR` and `WARLOCK_RELEASE_CURRENT` in its environment.
   */
  restart?: { command?: string; timeoutMs?: number };
  /** Post-activation health verification */
  verify?: {
    /** Health URL. Required by `release verify`. */
    url?: string;
    /** @default 200 */
    expectedStatus?: number;
    /** Attempts after the first one. @default 5 */
    retries?: number;
    /** Wait between attempts in milliseconds. @default 2000 */
    intervalMs?: number;
    /** Per-request timeout in milliseconds. @default 5000 */
    timeoutMs?: number;
    /** Dotted JSON path of the reported version. @default "version" */
    versionPath?: string;
    /** Dotted JSON path of the reported commit. @default "commit" */
    commitPath?: string;
    /** Which reported fields must match the active release. @default ["version", "commit"] */
    match?: Array<"version" | "commit">;
  };
};

export type ResolvedReleaseConfig = {
  directory: string;
  distDir: string;
  include: string[];
  linkNodeModules: boolean;
  checks: ReleaseCheck[];
  migrations: NonNullable<ReleaseConfig["migrations"]>;
  restart: { command?: string; timeoutMs: number };
  verify: {
    url?: string;
    expectedStatus: number;
    retries: number;
    intervalMs: number;
    timeoutMs: number;
    versionPath: string;
    commitPath: string;
    match: Array<"version" | "commit">;
  };
};

export type CommandResult = {
  code: number;
  /** Last part of the combined stdout and stderr */
  output: string;
  timedOut?: boolean;
};

export type CommandRunnerOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

/** Runs one shell command. Tests pass a fake; the default spawns a shell. */
export type CommandRunner = (
  command: string,
  options: CommandRunnerOptions,
) => Promise<CommandResult>;

export type GateCheckResult = {
  name: string;
  command: string;
  status: "passed" | "failed";
  exitCode: number;
  durationMs: number;
  /** Tail of the check's output, kept for failed checks */
  output?: string;
};

export type MigrationSnapshot = {
  executed: string[];
  tables: string[];
  indexes: Record<string, string[]>;
};

export type MigrationProof = {
  target: string | null;
  provedAt: string;
  passed: boolean;
  before: MigrationSnapshot;
  after: MigrationSnapshot;
  expected: string[];
  applied: string[];
  tablesAdded: string[];
  tablesRemoved: string[];
  indexesChanged: Record<string, { added: string[]; removed: string[] }>;
  problems: string[];
};

export type ReleaseStatus = "candidate" | "gated" | "staged" | "active" | "superseded";

export type ReleaseManifest = {
  schema: 1;
  id: string;
  version: string;
  commit: string;
  createdAt: string;
  nodeVersion: string;
  lockfile: { file: string; sha256: string } | null;
  status: ReleaseStatus;
  gate?: { passed: boolean; ranAt: string; results: GateCheckResult[] };
  migrations?: MigrationProof;
  staged?: { at: string; files: number };
  activation?: {
    at: string;
    previousId: string | null;
    restarted: boolean;
  };
  verification?: {
    at: string;
    ok: boolean;
    attempts: number;
    reason?: string;
  };
};

export type ReleaseLogEntry = {
  at: string;
  event:
    | "candidate"
    | "gate"
    | "migrations"
    | "stage"
    | "activate"
    | "verify"
    | "rollback"
    | "prune";
  release: string | null;
  ok: boolean;
  detail?: string;
};
