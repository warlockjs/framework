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
};

/** Background work of one process: schedules and queue counts, each `available: false` when its package is not installed. */
export type DevtoolsJobsReport = {
  available: { scheduler: boolean; queue: boolean };
  schedules: DevtoolsScheduleInfo[];
  /** Job counts per queue and state (`waiting`, `active`, `delayed`, `failed`, `completed`). */
  queues: { name: string; counts: Record<string, number> }[];
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
  { id: "ai", title: "AI", production: false },
  { id: "agents", title: "Agents", production: false },
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
