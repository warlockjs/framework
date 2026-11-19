/**
 * The contracts of the devtools production monitor: the shapes the server
 * stores, the JSON its API returns, and the few constants both sides share.
 *
 * This file has NO imports, so the dashboard (`ui-src/`) can import its types
 * too. Every timestamp is epoch milliseconds, every duration milliseconds,
 * every size bytes. Absent values are `null`, never missing.
 */

// ---------------------------------------------------------------------------
// Modes, roles and stages
// ---------------------------------------------------------------------------

/** Where the dashboard runs: the loopback development dashboard or the signed-in production monitor. */
export type DevtoolsMode = "development" | "production";

/** What an account may do: `admin` manages users and the dashboard, `viewer` reads. */
export type DevtoolsRole = "admin" | "viewer";

/**
 * Where a browser session stands. Only `active` reaches the data routes;
 * every other stage reaches only the sign-in steps it needs next.
 */
export type DevtoolsSessionStage =
  | "signed-out"
  | "password-change"
  | "mfa-enrol"
  | "mfa-verify"
  | "active";

/** How an account's current password was set. `env` and `reset` passwords must be changed at the next sign-in. */
export type DevtoolsPasswordSource = "env" | "setup" | "invite" | "user" | "reset";

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

/** One process that runs the monitor (a pm2 or cluster worker, a container). */
export type DevtoolsInstanceInfo = {
  /** Stable for the life of the process: `<host>:<pid>:<start time base36>`. */
  id: string;
  /** What the dashboard shows: `<host> #<worker>` or `<host> pid <pid>`. */
  label: string;
  host: string;
  pid: number;
  /** pm2's `NODE_APP_INSTANCE` / `pm_id`, or the cluster worker id; `null` when neither is set. */
  worker: string | null;
  startedAt: number;
  /** When the instance last wrote its report (the current time for the instance answering). */
  seenAt: number;
  nodeVersion: string;
};

// ---------------------------------------------------------------------------
// Histograms (mergeable across instances)
// ---------------------------------------------------------------------------

/**
 * Upper bounds (inclusive, ms) of the latency buckets every histogram uses.
 * A histogram's `counts` has one more entry than this list: the last entry
 * counts everything above the highest bound. Fixed bounds make histograms
 * from several instances merge exactly.
 */
export const DEVTOOLS_LATENCY_BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000,
] as const;

/** A latency histogram over `DEVTOOLS_LATENCY_BUCKETS_MS`. */
export type DevtoolsHistogram = {
  /** `DEVTOOLS_LATENCY_BUCKETS_MS.length + 1` entries. */
  counts: number[];
  count: number;
  sumMs: number;
  maxMs: number;
};

// ---------------------------------------------------------------------------
// Query, route and error statistics
// ---------------------------------------------------------------------------

/** Statistics for one normalized query shape (literals and bindings replaced by `?`). */
export type DevtoolsQueryShapeStats = {
  /** First 16 hex characters of the SHA-256 of `shape`; the id the API and EXPLAIN use. */
  id: string;
  /** The normalized query, at most 2000 characters. Never holds a value. */
  shape: string;
  driver: "postgres" | "mongodb";
  connection: string;
  count: number;
  errors: number;
  histogram: DevtoolsHistogram;
  /** Sampled requests in which this shape reached the N+1 threshold, and the highest count in one request. */
  nPlusOne: { requests: number; maxPerRequest: number };
  /** The slowest run seen; its values stay in the process that ran it (see EXPLAIN). */
  slowest: {
    durationMs: number;
    at: number;
    route: string | null;
    requestId: string | null;
    instance: string;
  } | null;
  firstSeen: number;
  lastSeen: number;
  /** Whether EXPLAIN can run for this shape (a Postgres `SELECT`/`WITH`, or a MongoDB `find`/`aggregate`/`count`). */
  explainable: boolean;
};

/** Time spent in one named request phase (middleware, validation, handler, …) on one route. */
export type DevtoolsRoutePhaseStats = {
  name: string;
  count: number;
  sumMs: number;
  maxMs: number;
};

/** Statistics for one route pattern and method. */
export type DevtoolsRouteStats = {
  /** `"<METHOD> <route pattern>"`, e.g. `"GET /posts/:slug"`. */
  key: string;
  method: string;
  route: string;
  count: number;
  /** Responses with a 5xx status or a thrown error. */
  errors: number;
  histogram: DevtoolsHistogram;
  /** At most 30 phases, slowest total first. */
  phases: DevtoolsRoutePhaseStats[];
  slowest: { durationMs: number; at: number; requestId: string | null; instance: string } | null;
};

/** Errors grouped by fingerprint (normalized message + route + source). */
export type DevtoolsErrorGroup = {
  /** First 16 hex characters of the SHA-256 of the fingerprint. */
  id: string;
  /** The latest message as raised, at most 500 characters. */
  message: string;
  /** The error class name when known (`TypeError`). */
  name: string | null;
  source: "request" | "log";
  route: string | null;
  status: number | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  lastRequestId: string | null;
  /** The latest stack, at most 4000 characters; `null` when none was available. */
  stack: string | null;
};

/** A warn/error log entry kept for the Logs panel in production (no context: it may hold values). */
export type DevtoolsReportLogEntry = {
  level: "debug" | "info" | "warn" | "error" | "success";
  module: string;
  action: string;
  /** At most 1000 characters. */
  message: string;
  at: number;
  requestId: string | null;
};

// ---------------------------------------------------------------------------
// Resources, health, jobs
// ---------------------------------------------------------------------------

/** One resource reading of a process. */
export type DevtoolsResourcePoint = {
  at: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  /** Process CPU time over wall time since the previous point, 0–100 per core (can exceed 100). */
  cpuPercent: number;
  eventLoopDelayP50Ms: number;
  eventLoopDelayP99Ms: number;
  eventLoopDelayMaxMs: number;
  /** `performance.eventLoopUtilization()` since the previous point, 0–1. */
  eventLoopUtilization: number;
  /** Garbage collections since the previous point. */
  gcCount: number;
  /** Total GC pause since the previous point. */
  gcPauseMs: number;
};

/** The latest resource reading plus values that change rarely. */
export type DevtoolsResourceSnapshot = DevtoolsResourcePoint & {
  heapLimitBytes: number;
  uptimeSeconds: number;
  /** Totals since the monitor started, by GC kind. */
  gcByKind: Record<
    "minor" | "major" | "incremental" | "weakcb",
    { count: number; pauseMs: number }
  >;
};

/** Readiness checks (core's `health` registry) of one process, with a short history. */
export type DevtoolsHealthReport = {
  status: "ok" | "error" | "unknown";
  checkedAt: number | null;
  checks: Record<string, boolean>;
  /** Newest last, at most 60 entries. */
  history: { at: number; status: "ok" | "error"; failed: string[] }[];
};

/** One scheduled job (`@warlock.js/scheduler`). */
export type DevtoolsScheduleInfo = {
  name: string;
  /** The cron expression, or `null` for an interval schedule. */
  cron: string | null;
  /** A readable interval such as `"every 5 minutes"`, or `null`. */
  interval: string | null;
  isRunning: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
  failures: number;
  /** The latest runs, newest first (at most 10). Absent when the scheduler keeps no history. */
  recentRuns?: DevtoolsScheduleRun[];
};

/** One recorded run of a scheduled job; the error is a message, never a stack. */
export type DevtoolsScheduleRun = {
  startedAt: number;
  durationMs: number;
  outcome: "success" | "failed" | "skipped";
  error?: string;
  skipReason?: string;
};

/** Background work of one process: schedules and queue counts, each `available: false` when its package is not installed. */
export type DevtoolsJobsReport = {
  available: { scheduler: boolean; queue: boolean };
  schedules: DevtoolsScheduleInfo[];
  /** Job counts per queue and state (`waiting`, `active`, `delayed`, `failed`, `completed`). */
  queues: DevtoolsQueueInfo[];
};

/** One queue's job counts. `countsAvailable: false` when the active driver cannot count. */
export type DevtoolsQueueInfo = {
  name: string;
  counts: Record<string, number>;
  countsAvailable?: boolean;
};

/** What the capture did since the process started. */
export type DevtoolsCaptureCounters = {
  sampleRate: number;
  requests: number;
  sampled: number;
  /** Unsampled requests kept as a summary because they were slow or failed. */
  keptUnsampled: number;
  /** Samples written to the database. */
  stored: number;
  /** Samples not written because the per-minute budget was spent. */
  droppedStored: number;
  /** Query shapes, routes and error groups evicted to keep memory bounded. */
  evictedShapes: number;
  evictedRoutes: number;
  evictedErrors: number;
  /** Queries not kept inside a sampled request because it reached its per-request limit. */
  droppedQueries: number;
};

/**
 * Everything one process reports, written to the database every
 * `reportIntervalMs` (one row per instance) and merged by the dashboard.
 * Serialized it stays under 256 KB: lists are trimmed from the end.
 */
export type DevtoolsInstanceReport = {
  instance: DevtoolsInstanceInfo;
  at: number;
  resources: { snapshot: DevtoolsResourceSnapshot; history: DevtoolsResourcePoint[] };
  /** At most 200, highest total time first. */
  queries: DevtoolsQueryShapeStats[];
  /** At most 200, highest total time first. */
  routes: DevtoolsRouteStats[];
  /** At most 50, newest first. */
  errors: DevtoolsErrorGroup[];
  /** At most 50, newest first. */
  logs: DevtoolsReportLogEntry[];
  health: DevtoolsHealthReport;
  jobs: DevtoolsJobsReport;
  capture: DevtoolsCaptureCounters;
};

// ---------------------------------------------------------------------------
// Requests (stored samples)
// ---------------------------------------------------------------------------

/**
 * A request row. Matches the development `DevtoolsRequestSummary` field for
 * field, plus where it was captured.
 */
export type DevtoolsSampleSummary = {
  id: string;
  method: string;
  path: string;
  route?: string;
  status?: number;
  startedAt: number;
  durationMs?: number;
  queryCount: number;
  warningCount: number;
  /** Read from the persisted request log only. */
  persisted?: true;
  /** The instance that served the request. */
  instance?: string;
  /** Kept because it was slow or failed, without a timeline (the request was not sampled). */
  partial?: true;
};

/** A query inside a stored sample: the shape only, never the SQL text with values or the bindings. */
export type DevtoolsSampleQuery = {
  id: string;
  connection: string;
  driver: "postgres" | "mongodb";
  /** Same as `shape`: kept under this name so the request view renders it like a development query. */
  sql?: string;
  collection?: string;
  command?: string;
  shape: string;
  shapeId: string;
  startedAt: number;
  durationMs: number;
  rowCount?: number;
  error?: string;
};

/** The timeline of a sampled request, with every value removed (see the redaction rules). */
export type DevtoolsSampleDetail = DevtoolsSampleSummary & {
  error?: string;
  phases: { name: string; startedAt: number; durationMs: number }[];
  queries: DevtoolsSampleQuery[];
  /** Cache operation counts only; keys are not kept. */
  cache: { hits: number; misses: number; writes: number };
  /** Log entries without context. */
  logs: { level: string; module: string; action: string; message: string; at: number }[];
  warnings: { type: "n+1"; message: string; shape: string; count: number }[];
  /** Queries left out because the request reached `maxQueriesPerRequest`. */
  droppedQueries: number;
};

// ---------------------------------------------------------------------------
// API views (what the dashboard reads)
// ---------------------------------------------------------------------------

/** `GET api/instances`. */
export type DevtoolsInstancesView = {
  /** The instance that answered this request. */
  current: string;
  /** Instances seen in the last 5 minutes (the answering one included), newest first. */
  instances: DevtoolsInstanceInfo[];
};

/** `GET api/resources?instance=<id|all>`. */
export type DevtoolsResourcesView = {
  instances: {
    instance: DevtoolsInstanceInfo;
    snapshot: DevtoolsResourceSnapshot;
    history: DevtoolsResourcePoint[];
  }[];
};

/** A shape row with figures computed from its histogram. */
export type DevtoolsQueryShapeRow = DevtoolsQueryShapeStats & {
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
  /** Ids of the instances that reported this shape. */
  instances: string[];
};

/** `GET api/queries/stats?instance=&sort=total|p95|count|n+1&limit=`. */
export type DevtoolsQueryStatsView = {
  shapes: DevtoolsQueryShapeRow[];
  /** The sample rate the counts come from; counts are of sampled requests only. */
  sampleRate: number;
  instanceCount: number;
  evicted: number;
};

/** A route row with figures computed from its histogram. */
export type DevtoolsRouteStatsRow = DevtoolsRouteStats & {
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
  instances: string[];
};

/** `GET api/routes/stats?instance=&sort=total|p95|count|errors&limit=`. */
export type DevtoolsRouteStatsView = {
  routes: DevtoolsRouteStatsRow[];
  sampleRate: number;
  instanceCount: number;
};

/** `GET api/health?instance=`. */
export type DevtoolsHealthView = {
  instances: { instance: DevtoolsInstanceInfo; report: DevtoolsHealthReport }[];
};

/** `GET api/errors?instance=&limit=`. */
export type DevtoolsErrorsView = {
  groups: (DevtoolsErrorGroup & { instances: string[] })[];
};

/**
 * One row of `GET api/logs?level=&module=&instance=` (newest first), in both
 * modes. Development rows carry `context` and no `instance`; production rows
 * carry `instance` and never `context`.
 */
export type DevtoolsLogRow = DevtoolsReportLogEntry & {
  instance: string | null;
  context?: unknown;
};

/** `GET api/logs`: the rows, newest first (a plain array, as in 5.55). */
export type DevtoolsLogsView = DevtoolsLogRow[];

/** `GET api/jobs?instance=`. */
export type DevtoolsJobsView = {
  instances: { instance: DevtoolsInstanceInfo; report: DevtoolsJobsReport }[];
};

/** `POST api/queries/:shapeId/explain`. */
export type DevtoolsExplainResult = {
  shapeId: string;
  driver: "postgres" | "mongodb";
  /** `true` only when the project allows executing plans (`explain.executing`). */
  executing: boolean;
  plan: unknown;
  /** The instance whose example ran the EXPLAIN. */
  instance: string;
};

/** One dashboard tab, as `GET api/panels` lists it (enabled tabs only, in display order). */
export type DevtoolsPanelInfo = {
  id: string;
  title: string;
  /** `built-in` tabs are React views in the bundle; `package` tabs load `panels/<id>/view.js`. */
  type: "built-in" | "package";
  /** Whether the panel declares a shared view (`DevtoolsPanel.share`); always `false` for built-in tabs. */
  shareable: boolean;
};

/**
 * The built-in tabs, in display order, with whether production shows them
 * when the project says nothing (`production.panels` overrides per id).
 *
 * The AI section (`ai-reports`, `ai`, `agents`, `ai-models`, `ai-errors`,
 * `ai-evaluate`) sits under "AI" in the sidebar. `ai` keeps its id (it is the
 * Runs page) so existing links and `production.panels.ai` keep working. In
 * production the three report tabs show only when the AI feed is available
 * (Panoptic loads), unless `production.panels` turns one on explicitly.
 */
export const DEVTOOLS_BUILT_IN_PANELS = [
  { id: "requests", title: "Requests", production: true },
  { id: "queries", title: "Queries", production: true },
  { id: "routes", title: "Routes", production: true },
  { id: "resources", title: "Resources", production: true },
  { id: "health", title: "Health", production: true },
  { id: "errors", title: "Errors", production: true },
  { id: "logs", title: "Logs", production: true },
  { id: "jobs", title: "Jobs", production: true },
  { id: "mail", title: "Mail", production: false },
  { id: "ai-reports", title: "Reports", production: true },
  { id: "ai", title: "Runs", production: false },
  { id: "agents", title: "Agents", production: false },
  { id: "ai-models", title: "Models", production: true },
  { id: "ai-errors", title: "Errors", production: true },
  { id: "ai-evaluate", title: "Evaluate", production: false },
  { id: "api", title: "API", production: false },
] as const;

/** The id of a built-in tab. */
export type DevtoolsBuiltInPanelId = (typeof DEVTOOLS_BUILT_IN_PANELS)[number]["id"];

// ---------------------------------------------------------------------------
// Accounts, sessions, invites
// ---------------------------------------------------------------------------

/** An account as the API shows it (never a hash or a secret). */
export type DevtoolsAccountView = {
  id: string;
  email: string;
  role: DevtoolsRole;
  twoFactor: {
    totp: boolean;
    passkeys: { id: string; name: string; createdAt: number; lastUsedAt: number | null }[];
    recoveryCodesLeft: number;
  };
  mustChangePassword: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};

/** `GET api/auth/session`: who is signed in and what comes next. */
export type DevtoolsSessionView = {
  mode: DevtoolsMode;
  stage: DevtoolsSessionStage;
  /** `null` when signed out, and in development (no accounts there). */
  account: DevtoolsAccountView | null;
  /** `admin` in development; `null` when signed out. */
  role: DevtoolsRole | null;
  /** The token to send as `X-Devtools-Csrf` on every POST/PUT/PATCH/DELETE; `null` when signed out and in development. */
  csrf: string | null;
  /** When the session ends at the latest; `null` when signed out and in development. */
  expiresAt: number | null;
  /** The instance that answered; `null` when signed out. */
  instance: DevtoolsInstanceInfo | null;
  /** Sign-in methods the server offers; `null` when signed out. */
  methods: { totp: true; passkeys: boolean } | null;
  /** Read-only share links: `enabled` mirrors `production.share.enabled`; `null` when signed out and in development. */
  share: { enabled: boolean } | null;
  /** The installed `@warlock.js/core` version; `null` when signed out or not found. */
  warlockVersion: string | null;
  /** The app's own `package.json` name and version (nothing else is read); `null` when signed out or not found. */
  app: { name: string; version: string } | null;
};

/** `POST api/auth/login` body. */
export type DevtoolsLoginInput = { email: string; password: string };

/** Answer of every sign-in step: the next stage, and the new CSRF token when the session changed. */
export type DevtoolsAuthStepResult = { stage: DevtoolsSessionStage; csrf: string | null };

/** `POST api/auth/totp/start` (and `api/account/totp/start`). */
export type DevtoolsTotpEnrolment = {
  /** Base32, for manual entry. */
  secret: string;
  /** `otpauth://totp/...`, rendered as a QR code by the dashboard. */
  uri: string;
  issuer: string;
  account: string;
};

/** Recovery codes, shown once. */
export type DevtoolsRecoveryCodes = { codes: string[] };

/** A pending or used invite. */
export type DevtoolsInviteView = {
  id: string;
  email: string;
  role: DevtoolsRole;
  createdAt: number;
  expiresAt: number;
  createdBy: string | null;
  usedAt: number | null;
};

/** `POST api/admin/invites`: the token appears only in this answer. */
export type DevtoolsCreatedInvite = { invite: DevtoolsInviteView; token: string };

/** `GET api/admin/users`. */
export type DevtoolsUserListView = {
  accounts: DevtoolsAccountView[];
  invites: DevtoolsInviteView[];
};

/** A session as its owner sees it (`GET api/account/sessions`). */
export type DevtoolsSessionInfo = {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
};

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

/** Where a share link stands. `revoked` wins over `expired`. */
export type DevtoolsShareStatus = "active" | "expired" | "revoked";

/** A share link as the admin screen shows it (never the token or its hash). */
export type DevtoolsShareView = {
  id: string;
  /** The id of the panel the link opens. */
  panel: string;
  /** What the admin called it, 1-80 characters. */
  label: string;
  /** The email of the admin who made it; `null` when that account is gone. */
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
  /** How many times the link was used, counted at most once a minute. */
  uses: number;
  status: DevtoolsShareStatus;
};

/** `GET api/admin/shares`. */
export type DevtoolsShareList = {
  enabled: boolean;
  /** The longest life a link may have, in days. */
  maxDays: number;
  /** The panels that declare a shared view. */
  panels: { id: string; title: string }[];
  /** Newest first. */
  shares: DevtoolsShareView[];
};

/** `POST api/admin/shares` body. `label` is 1-80 characters, `days` a whole number from 1 to `maxDays`. */
export type DevtoolsShareCreateInput = { panel: string; label: string; days: number };

/** `POST api/admin/shares`: the URL (with the token in its fragment) appears only in this answer. */
export type DevtoolsCreatedShare = { share: DevtoolsShareView; url: string };

/**
 * What a share link opens, answered by `POST api/share/open` and
 * `GET api/share/info`: the panel and the names the shared view may load.
 */
export type DevtoolsShareOpenAnswer = {
  panel: string;
  /** The panel's title. */
  title: string;
  label: string;
  expiresAt: number;
  /** Served names from the panel's `assets` the shared page may load. */
  assets: string[];
  /** Whether the shared page may load images from the panel's `files`. */
  files: boolean;
};

/** The longest label of a share link. */
export const DEVTOOLS_SHARE_LABEL_MAX = 80;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** Every audited event. `login.failed` and `mfa.failed` are the ones rate limits count. */
export type DevtoolsAuditType =
  | "admin.seeded"
  | "admin.reset"
  | "setup.completed"
  | "login.succeeded"
  | "login.failed"
  | "login.blocked"
  | "mfa.succeeded"
  | "mfa.failed"
  | "mfa.enrolled"
  | "mfa.removed"
  | "recovery-code.used"
  | "recovery-codes.regenerated"
  | "passkey.added"
  | "passkey.removed"
  | "password.changed"
  | "logout"
  | "session.revoked"
  | "invite.created"
  | "invite.revoked"
  | "invite.accepted"
  | "account.role-changed"
  | "account.removed"
  | "account.mfa-reset"
  | "account.signed-out"
  | "dashboard.disabled"
  | "dashboard.enabled"
  | "dashboard.locked"
  | "explain.run"
  | "requests.cleared"
  | "panel.action"
  | "share.created"
  | "share.revoked"
  | "share.failed";

/** The audit types that count toward the account, IP and global failure limits. */
export const DEVTOOLS_FAILURE_AUDIT_TYPES: readonly DevtoolsAuditType[] = [
  "login.failed",
  "mfa.failed",
  "share.failed",
];

/** One audit log entry. */
export type DevtoolsAuditEntry = {
  id: string;
  at: number;
  type: DevtoolsAuditType;
  /** The account acting or targeted; `null` for an unknown email or the CLI. */
  accountId: string | null;
  /** The email as typed or as stored, lower-cased; `null` when there was none. */
  email: string | null;
  /** `"cli"` for a command, else the client IP after trusted-proxy resolution. */
  ip: string | null;
  /** At most 200 characters. */
  userAgent: string | null;
  /** Small flat facts: target account, role, shape id, panel route. Never a secret. */
  detail: Record<string, string | number | boolean | null>;
  /** Short reference shown to users in error messages (8 characters). */
  ref: string;
};

// ---------------------------------------------------------------------------
// Errors the API returns
// ---------------------------------------------------------------------------

/**
 * Error codes in API answers. Each has a fixed message (see
 * `DEVTOOLS_ERROR_MESSAGES` in `errors.ts`) that says what failed and what to
 * do next.
 */
export type DevtoolsErrorCode =
  | "auth.invalid-credentials"
  | "auth.invalid-code"
  | "auth.invalid-setup-token"
  | "auth.password-too-short"
  | "auth.password-too-long"
  | "auth.password-common"
  | "auth.password-same-as-email"
  | "auth.password-unchanged"
  | "auth.wrong-current-password"
  | "auth.busy"
  | "invite.invalid"
  | "invite.email-taken"
  | "account.not-found"
  | "account.last-admin"
  | "account.self"
  | "account.last-factor"
  | "role.forbidden"
  | "csrf.invalid"
  | "passkey.unavailable"
  | "passkey.failed"
  | "explain.not-allowed"
  | "explain.unsupported"
  | "explain.elsewhere"
  | "explain.failed"
  | "request.not-found"
  | "request.invalid-filter"
  | "share.not-found"
  | "stream.too-many"
  | "ai.range-invalid"
  | "ai.evaluate-unavailable"
  | "ai.prompt-not-found"
  | "ai.evaluate-failed"
  | "input.invalid"
  | "server.error";

/** The JSON body of every failed API call. */
export type DevtoolsApiErrorBody = {
  /** What failed and what to do next. */
  error: string;
  code: DevtoolsErrorCode;
  /** Short reference to quote to an admin; also written to the audit log or server log. */
  ref?: string;
  /** The instance that answered, when it matters (`explain.elsewhere`). */
  instance?: string;
};

// ---------------------------------------------------------------------------
// AI section: reports, runs, models, errors, evaluate
// ---------------------------------------------------------------------------

/**
 * Upper bounds (inclusive, ms) of the latency buckets of the AI rollups.
 * Model calls take seconds, so these differ from `DEVTOOLS_LATENCY_BUCKETS_MS`.
 * A histogram has one more count than this list: the last counts everything
 * above five minutes. Fixed bounds make rollups from several processes add up
 * exactly. Changing them is a breaking change of the stored rollups.
 */
export const DEVTOOLS_AI_LATENCY_BUCKETS_MS = [
  250, 500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 45000, 60000, 120000, 300000,
] as const;

/** The date-range presets of the Reports, Models and Errors pages. */
export type DevtoolsAiRangePreset = "24h" | "7d" | "30d";

/** The range a report covers, after the server aligned it to its buckets. */
export type DevtoolsAiResolvedRange = {
  preset: DevtoolsAiRangePreset | "custom";
  /** Inclusive start, on an hour boundary. */
  from: number;
  /** Exclusive end, on an hour boundary. */
  to: number;
  /** Bucket width of the charts: 1 hour, 6 hours or 1 day. */
  stepMs: number;
  /** The browser's offset from UTC (minutes east), used to align day buckets. */
  utcOffsetMinutes: number;
};

/** Why an AI page has nothing to show; `title`, `message` and `command` are written for the page. */
export type DevtoolsAiUnavailableReasonView =
  | "ai-missing"
  | "panoptic-missing"
  | "panoptic-failed"
  | "observation-off"
  | "not-collected"
  | "table-missing"
  | "reports-off";

/** The answer of any AI route that cannot serve its data. */
export type DevtoolsAiUnavailableView = {
  available: false;
  reason: DevtoolsAiUnavailableReasonView;
  title: string;
  message: string;
  /** A command or config line to copy; `null` when there is none. */
  command: string | null;
  /** The load error and versions for `panoptic-failed`; otherwise `null`. */
  detail: string | null;
};

/** Token counts. `input` is the whole prompt (cache reads and writes included) on every provider. */
export type DevtoolsAiTokenTotals = {
  input: number;
  output: number;
  /** Prompt tokens read from the provider's cache (part of `input`). */
  cached: number;
  /** Prompt tokens written to the provider's cache (part of `input`). */
  cacheWrite: number;
  /** Reasoning tokens (part of `output`). */
  reasoning: number;
};

/**
 * Estimated cost. `estimatedUsd` sums only runs whose model has pricing; runs
 * that used tokens on a model without pricing are counted in `unpricedRuns`
 * and `unpricedTokens`, never as zero cost.
 */
export type DevtoolsAiCostTotals = {
  estimatedUsd: number;
  pricedRuns: number;
  unpricedRuns: number;
  unpricedTokens: number;
};

/** Latency from the bucketed histogram: each figure is a bucket's upper bound (`null` with no runs). */
export type DevtoolsAiLatencyTotals = {
  p50Ms: number | null;
  p95Ms: number | null;
  meanMs: number | null;
};

/** Totals over a range (or one row of a breakdown). */
export type DevtoolsAiTotals = {
  runs: number;
  completed: number;
  failed: number;
  /** Runs that stopped early: `incomplete` and `max-iterations`. */
  incomplete: number;
  cancelled: number;
  /** `(failed + incomplete) / runs`, from 0 to 1; 0 with no runs. Cancelled runs are not errors. */
  errorRate: number;
  tokens: DevtoolsAiTokenTotals;
  cost: DevtoolsAiCostTotals;
  latency: DevtoolsAiLatencyTotals;
  /** Runs where a `fallbackModel()` chain answered from a later model at least once. */
  fallbackRuns: number;
  /** Runs where the provider refused at least once (finish reason `refusal` or a content filter). */
  refusals: number;
};

/**
 * Time series for a stacked chart: `values[i]` belongs to `buckets[i]`. At
 * most five named series; the rest are summed into one `other` series.
 */
export type DevtoolsAiSeriesSet = {
  /** Bucket starts, oldest first. */
  buckets: number[];
  series: {
    /** Stable identity (`provider/model`, an agent name, a category); the UI keys colours on it. */
    key: string;
    label: string;
    values: number[];
    /** `true` for the summed "Other" series. */
    other: boolean;
  }[];
};

/** One bucket of the error-rate line. */
export type DevtoolsAiRatePoint = {
  at: number;
  runs: number;
  /** Failed plus incomplete runs. */
  errors: number;
  /** `errors / runs`; `null` for a bucket without runs (the line has a gap there). */
  rate: number | null;
};

/** A row of the top agents or top models table. */
export type DevtoolsAiBreakdownRow = {
  /** The agent name, or `provider/model`. */
  key: string;
  label: string;
  /** The provider for a model row; `null` for an agent row. */
  provider: string | null;
  totals: DevtoolsAiTotals;
  /** Share of the range's estimated cost, 0 to 1 (share of runs when nothing was priced). */
  share: number;
};

/** The filter values present in a range, for the filter row. */
export type DevtoolsAiFilterOptions = {
  agents: string[];
  /** `provider/model` keys. */
  models: string[];
  providers: string[];
};

/** `GET api/ai/reports`. */
export type DevtoolsAiReportView =
  | DevtoolsAiUnavailableView
  | {
      available: true;
      range: DevtoolsAiResolvedRange;
      /** The period of the same length just before `range`. */
      previousRange: { from: number; to: number };
      /** `false` when part of the previous period is older than the kept history: its totals are partial. */
      previousComplete: boolean;
      totals: DevtoolsAiTotals;
      previous: DevtoolsAiTotals;
      /** Estimated USD per bucket, by model (top five plus Other). */
      costByModel: DevtoolsAiSeriesSet;
      /** Tokens per bucket: series `uncached`, `cached`, `output`. */
      tokens: DevtoolsAiSeriesSet;
      errorRate: DevtoolsAiRatePoint[];
      /** Up to 10 rows, highest estimated cost first (most runs when nothing was priced). */
      topAgents: DevtoolsAiBreakdownRow[];
      topModels: DevtoolsAiBreakdownRow[];
      /** `provider/model` keys that used tokens without pricing in the range. */
      unpricedModels: string[];
      filters: DevtoolsAiFilterOptions;
      /** `true` when `@warlock.js/ai` observes nothing, so new runs are not counted. */
      observationOff: boolean;
      generatedAt: number;
    };

/** Whether a model's runs carried pricing in the range; `no-tokens` when no run used tokens. */
export type DevtoolsAiPricingState = "set" | "missing" | "partial" | "no-tokens";

/** One row of the Models page. */
export type DevtoolsAiModelRow = {
  /** `provider/model`. */
  key: string;
  model: string;
  provider: string;
  totals: DevtoolsAiTotals;
  pricing: DevtoolsAiPricingState;
  /** Estimated USD per priced run; `null` when no run was priced. */
  costPerRunUsd: number | null;
  /** `fallbackRuns / runs`, 0 to 1. */
  fallbackRate: number;
  /** Agents that used the model, most runs first (at most 5). */
  agents: string[];
  /** Start of the last hour with a run. */
  lastSeenAt: number;
};

/** `GET api/ai/models`. */
export type DevtoolsAiModelsView =
  | DevtoolsAiUnavailableView
  | {
      available: true;
      range: DevtoolsAiResolvedRange;
      totals: DevtoolsAiTotals;
      /** Most runs first. */
      models: DevtoolsAiModelRow[];
      /** Runs per bucket by model (top five plus Other). */
      runsByModel: DevtoolsAiSeriesSet;
      filters: DevtoolsAiFilterOptions;
      observationOff: boolean;
      generatedAt: number;
    };

/** How failed runs are grouped on the Errors page. */
export type DevtoolsAiErrorCategory =
  | "rate-limit"
  | "timeout"
  | "refusal"
  | "provider"
  | "budget"
  | "tool"
  | "schema"
  | "incomplete"
  | "other";

/** Every category, in the order the Errors page lists them. */
export const DEVTOOLS_AI_ERROR_CATEGORIES = [
  "rate-limit",
  "timeout",
  "refusal",
  "provider",
  "budget",
  "tool",
  "schema",
  "incomplete",
  "other",
] as const satisfies readonly DevtoolsAiErrorCategory[];

/** One category of failed runs. */
export type DevtoolsAiErrorGroup = {
  category: DevtoolsAiErrorCategory;
  /** "Rate limit", "Timeout", "Refusal", "Provider error", "Budget", "Tool failed", "Invalid output", "Incomplete", "Other". */
  label: string;
  count: number;
  /** Share of all failed runs in the range, 0 to 1. */
  share: number;
  previousCount: number;
  /** At most 5 each, most first. */
  byModel: { key: string; count: number }[];
  byAgent: { key: string; count: number }[];
};

/** A recent failed run (development only: production keeps no run details). */
export type DevtoolsAiFailedRun = {
  traceId: string;
  /** The agent span that failed. */
  agent: string;
  /** `provider/model`, or `null` when unreported. */
  model: string | null;
  status: string;
  category: DevtoolsAiErrorCategory;
  /** The error code (`PROVIDER_RATE_LIMIT`) or error name. */
  code: string | null;
  /** The error message, secrets scrubbed, at most 300 characters. */
  message: string | null;
  endedAt: number;
  requestId: string | null;
};

/** `GET api/ai/errors`. */
export type DevtoolsAiErrorsView =
  | DevtoolsAiUnavailableView
  | {
      available: true;
      range: DevtoolsAiResolvedRange;
      totals: DevtoolsAiTotals;
      previous: DevtoolsAiTotals;
      /** `false` when part of the previous period is older than the kept history: its totals are partial. */
      previousComplete: boolean;
      /** Categories with at least one failed run, most first. */
      groups: DevtoolsAiErrorGroup[];
      /** Failed runs per bucket by category (top five plus Other). */
      overTime: DevtoolsAiSeriesSet;
      /** Newest first, at most 50; `null` in production. */
      recent: DevtoolsAiFailedRun[] | null;
      filters: DevtoolsAiFilterOptions;
      observationOff: boolean;
      generatedAt: number;
    };

/** Usage of one run as the Runs page shows it. */
export type DevtoolsAiUsageView = {
  input: number;
  output: number;
  total: number;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  /** `false` when `input` excludes cache tokens (the provider reports them on top). */
  inputIncludesCache: boolean | null;
};

/** One row of the Runs page (a Panoptic trace, content-free). */
export type DevtoolsAiRunRow = {
  traceId: string;
  requestId: string | null;
  sessionId: string | null;
  name: string;
  /** The root span type: `agent`, `workflow`, `supervisor`, … */
  type: string;
  status: string;
  startedAt: string;
  duration: number;
  usage: DevtoolsAiUsageView;
  /** Estimated USD; `null` when the run carried no pricing. */
  cost: number | null;
  models: string[];
  /** `promptName@promptVersion` of the root agent, or `null`. */
  promptKey: string | null;
  toolCalls: number;
  retries: number;
  incomplete: boolean;
};

/** A group of the Runs page (`groupBy=session|prompt|type`). */
export type DevtoolsAiRunGroup = {
  key: string;
  label: string;
  runs: number;
  failed: number;
  estimatedCostUsd: number;
  p95Ms: number | null;
  /** Trace ids of the group, newest first (at most 50). */
  traceIds: string[];
};

/** `GET api/ai/runs`. */
export type DevtoolsAiRunsView =
  | DevtoolsAiUnavailableView
  | {
      available: true;
      /** Newest first, at most `limit` (default 200). */
      runs: DevtoolsAiRunRow[];
      /** `null` unless `groupBy` was given. */
      groups: DevtoolsAiRunGroup[] | null;
      stats: {
        /** Runs matching the filter (before `limit`). */
        count: number;
        failed: number;
        /** Priced runs only. */
        estimatedCostUsd: number;
        /** Runs that used tokens on a model without pricing (not in `estimatedCostUsd`). */
        unpricedRuns: number;
        p50Ms: number | null;
        p95Ms: number | null;
      };
      /** How many traces the dashboard keeps (`maxRequests`). */
      capacity: number;
    };

/** A distinct system prompt seen in recent agent runs (the Evaluate picker). */
export type DevtoolsAiEvaluatePrompt = {
  /** The prompt's hash from the agent trace. */
  hash: string;
  /** Agents that used it, most recent first. */
  agents: string[];
  /** The newest run that carried its text. */
  runId: string;
  lastSeenAt: string;
  /** The first 200 characters. */
  preview: string;
  length: number;
};

/** `GET api/ai/evaluate`. */
export type DevtoolsAiEvaluateView =
  | DevtoolsAiUnavailableView
  | {
      available: true;
      /** Whether `panoptic.evaluate` (or `panoptic.dashboard.evaluate`) has a judge model. */
      configured: boolean;
      /** The judge model as `provider/name`; `null` when not configured. */
      judge: string | null;
      /** The configured default grading instructions; `""` when none. */
      instructions: string;
      /** Newest first, at most 50. */
      prompts: DevtoolsAiEvaluatePrompt[];
    };

/** `POST api/ai/evaluate` body: exactly one of `runId` and `systemPrompt`. */
export type DevtoolsAiEvaluateRequest = {
  /** An agent run whose system prompt text is kept. */
  runId?: string;
  /** A pasted prompt, 1 to 100,000 characters. */
  systemPrompt?: string;
  /** Overrides the configured instructions for this run; at most 4,000 characters. */
  instructions?: string;
};

/** `POST api/ai/evaluate` answer. */
export type DevtoolsAiEvaluateResult = {
  /** 0 to 1; `null` when the judge returned no score. */
  score: number | null;
  issues: string[];
  /** The judge model as `provider/name`. */
  judge: string;
  durationMs: number;
};
