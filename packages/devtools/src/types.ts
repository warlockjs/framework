import type { RequestLogRecord } from "@warlock.js/core";
import type { DevtoolsAgentTraceEvent } from "./sources/agent-trace-source";
import type { DevtoolsAiOptions } from "./ai/types";
import type { DevtoolsAiEvent } from "./sources/ai-source";
import type { DevtoolsMode, DevtoolsRole } from "./production/contracts";

export type * from "./production/contracts";
export type { DevtoolsAiOptions } from "./ai/types";

/**
 * The records the devtools collector keeps and the dashboard API returns.
 *
 * Every timestamp is epoch milliseconds (fractional allowed); every duration
 * is milliseconds. Nothing here is persisted — the collector is an in-memory
 * ring buffer that is lost on restart. Request history that must survive a
 * restart is read from core's persistent request log instead.
 */

/** Options accepted by `devtoolsConnector()`. */
export type DevtoolsOptions = {
  /**
   * URL prefix the dashboard and its API are served under.
   *
   * @default "/__warlock"
   */
  path?: string;
  /**
   * How many requests the ring buffer keeps; the oldest is evicted first.
   *
   * @default 200
   */
  maxRequests?: number;
  /**
   * How many times one query shape may run inside a single request before it
   * is reported as an N+1.
   *
   * @default 5
   */
  nPlusOneThreshold?: number;
  /**
   * Extra `Host` names the dashboard answers besides `localhost`,
   * `*.localhost`, `127.0.0.1` and `[::1]`, e.g. a custom dev hostname such as
   * `"app.test"`. An entry starting with `.` also matches every subdomain
   * (`".app.test"` matches `app.test` and `admin.app.test`). The socket must
   * still be loopback.
   *
   * @default []
   */
  allowedHosts?: readonly string[];
  /**
   * Answer requests that carry `X-Forwarded-For`, `X-Forwarded-Host`,
   * `X-Real-IP` or `Forwarded`. Off by default: a local proxy or tunnel makes
   * every visitor look like a loopback client. Turn on only for a local proxy
   * that nobody else can reach.
   *
   * @default false
   */
  allowProxied?: boolean;
  /**
   * Extra dashboard tabs. Each entry is a module specifier, loaded only in
   * development, whose default export is a `DevtoolsPanelExport`: a package
   * export such as `"@warlock.js/grimoire/devtools"` (resolved from the app
   * root) or a path starting with `./` (relative to the app root). An entry
   * may also be a `DevtoolsPanel` object, or a `[specifier, options]` pair
   * whose options object is passed to the panel factory next to `root` and
   * `mode` (`["@warlock.js/grimoire/devtools", { ttlMs: 60_000 }]`).
   *
   * @default []
   */
  panels?: readonly DevtoolsPanelEntry[];
  /**
   * The AI section (Reports, Models and Errors pages): hourly totals of runs,
   * tokens, estimated cost, errors and latency, kept in the app database in
   * production (table `devtools_ai_rollups`, in `devtoolsMigrations`) and in
   * JSON files under the storage folder in development.
   *
   * @default { reports: true, retentionDays: 30 (development) or 90 (production), flushIntervalMs: 60000 }
   */
  ai?: DevtoolsAiOptions;
  /**
   * The production monitor: a signed-in dashboard at a secret path. Off
   * unless `enabled` is `true`; read only when the app runs in production
   * (development keeps the loopback dashboard and ignores this block).
   * Secrets come from the environment, never from this object in source
   * control: `DEVTOOLS_PATH`, `DEVTOOLS_ADMIN_EMAIL`, and
   * `DEVTOOLS_ADMIN_PASSWORD` or `DEVTOOLS_SETUP_TOKEN`.
   *
   * @default undefined (off)
   */
  production?: DevtoolsProductionOptions;
};

/**
 * Options of the production monitor (`devtools.production`). Every value has
 * a safe default; only `enabled` must be set, and the path and first admin
 * come from the environment.
 */
export type DevtoolsProductionOptions = {
  /**
   * Turn the monitor on in production. Without it nothing is mounted and
   * nothing is captured.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The dashboard path. Prefer the `DEVTOOLS_PATH` environment variable; at
   * least 8 characters, never `/__warlock`.
   *
   * @default process.env.DEVTOOLS_PATH
   */
  path?: string;
  /**
   * Share of requests captured with a full timeline, 0–1. Slow and failed
   * requests outside the sample are kept as a summary.
   *
   * @default 0.1
   */
  sampleRate?: number;
  /**
   * A request at least this slow is kept even when not sampled.
   *
   * @default 1000
   */
  slowRequestMs?: number;
  /**
   * A query at least this slow counts in the query statistics even outside a
   * sampled request.
   *
   * @default 200
   */
  slowQueryMs?: number;
  /**
   * Sampled requests kept in memory per process (the live view).
   *
   * @default 200
   */
  maxRequests?: number;
  /**
   * How long stored request samples are kept, in hours.
   *
   * @default 24
   */
  requestRetentionHours?: number;
  /**
   * The most samples one process writes to the database per minute; the rest
   * stay in memory only.
   *
   * @default 120
   */
  maxStoredSamplesPerMinute?: number;
  /**
   * How often each process writes its report (resources, statistics, health)
   * to the database, in ms.
   *
   * @default 10000
   */
  reportIntervalMs?: number;
  /**
   * Proxies whose `X-Forwarded-For`, `X-Forwarded-Proto` and
   * `X-Forwarded-Host` headers are believed: IP addresses, CIDR ranges, or
   * `"loopback"` and `"private"`. Without an entry the socket address is the
   * client.
   *
   * @default []
   */
  trustedProxies?: readonly string[];
  /**
   * Answer only requests that arrived over HTTPS (directly or through a
   * trusted proxy). Turn off only to try the monitor on a local machine.
   *
   * @default true
   */
  requireHttps?: boolean;
  /**
   * When set, only these client IPs or CIDR ranges reach the dashboard;
   * everyone else gets a 404.
   *
   * @default [] (any client)
   */
  allowedIps?: readonly string[];
  /**
   * The public origin of the app (`https://app.example.com`), used for the
   * CSRF origin check and passkeys. Without it the request's own origin is
   * used.
   *
   * @default null
   */
  origin?: string;
  /** Session lifetime. */
  session?: {
    /** Signed out after this many idle minutes. @default 30 */
    idleMinutes?: number;
    /** Signed out after this many hours whatever happens. @default 8 */
    maxHours?: number;
  };
  /**
   * Who must use a second factor (an authenticator app or a passkey).
   * `"off"` requires nobody: users may still add a factor, and an account
   * that has one is always asked for it. Boot logs a warning when it is off.
   *
   * @default "admins"
   */
  twoFactor?: "off" | "admins" | "everyone";
  /** Password rules for accounts, invites and the first admin. */
  passwords?: {
    /** Shortest password, in characters; 8 or more. @default 8 */
    minLength?: number;
    /** Refuse passwords from the built-in common list. @default true */
    rejectCommon?: boolean;
  };
  /** Failed sign-in limits, counted over the audit log in a sliding window. */
  rateLimits?: {
    /** @default 15 */
    windowMinutes?: number;
    /** Failures per account before it is refused for the window. @default 5 */
    account?: number;
    /** Failures per client IP before it is refused for the window. @default 20 */
    ip?: number;
    /** Failures in total before the whole dashboard answers 404 for `lockMinutes`. @default 100 */
    global?: number;
    /** @default 15 */
    lockMinutes?: number;
  };
  /** EXPLAIN in production. */
  explain?: {
    /**
     * Allow executing plans (PostgreSQL `EXPLAIN ANALYZE`, MongoDB
     * `executionStats`). They run the query; leave off unless you accept that.
     *
     * @default false
     */
    executing?: boolean;
  };
  /**
   * Turn tabs on or off by id. Built-in tabs `mail`, `ai`, `agents`, `api`
   * and `processes` are off in production unless set to `true`; a package
   * panel shows only when it declares `production: true` or is set to `true`
   * here.
   *
   * @default {}
   */
  panels?: Readonly<Record<string, boolean>>;
  /**
   * Log levels the Logs tab keeps outside sampled requests.
   *
   * @default ["warn", "error"]
   */
  logLevels?: readonly DevtoolsLogEntry["level"][];
  /**
   * How long audit entries are kept, in days.
   *
   * @default 90
   */
  auditRetentionDays?: number;
  /** Passkeys as a second factor (needs `@simplewebauthn/server`). */
  passkeys?: {
    /** The name authenticators show. @default "Warlock monitor" */
    rpName?: string;
    /** The WebAuthn relying party id. @default the host of `origin`, else of the request */
    rpId?: string;
  };
  /**
   * Read-only share links: an admin creates a link to a panel that declares
   * `share` (the Grimoire product map), and anyone holding the link sees that
   * view without an account. Off unless `enabled` is `true`. Needs the
   * `devtools_shares` table (in `devtoolsMigrations`).
   */
  share?: {
    /** @default false */
    enabled?: boolean;
    /** The longest life an admin may give a link, in days (1–365). @default 30 */
    maxDays?: number;
  };
};

/** `DevtoolsOptions` with every default applied. */
export type ResolvedDevtoolsOptions = Required<
  Pick<DevtoolsOptions, "path" | "maxRequests" | "nPlusOneThreshold">
> &
  Pick<DevtoolsOptions, "allowedHosts" | "allowProxied" | "panels" | "production" | "ai">;

/** HTTP methods a panel data route may answer. */
export type DevtoolsPanelMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What a panel data route handler receives. */
export type DevtoolsPanelRequest = {
  /** Path parameters, e.g. `{ name: "checkout" }` for the route path `/flows/:name`. */
  params: Readonly<Record<string, string>>;
  /** Query string values; a key given more than once is an array. */
  query: Readonly<Record<string, string | readonly string[]>>;
  /** The parsed request body; `undefined` when there is none. */
  body: unknown;
  /**
   * `true` when the request came through a read-only share link (no signed-in
   * user). Only the routes listed in the panel's `share.routes` are reached
   * this way; leave developer detail (file paths, code, test names) out of
   * the answer. Absent for every other request.
   */
  shared?: boolean;
};

/**
 * One data route of a panel, served at `<path>/api/<panel id><route path>`
 * behind the devtools guard. The handler's return value is sent as JSON with
 * `Cache-Control: no-store`; `undefined` sends `204`. A thrown error with a
 * numeric `statusCode` answers that status with `{ error: message }`.
 */
export type DevtoolsPanelRoute = {
  /** @default "GET" */
  method?: DevtoolsPanelMethod;
  /** `""` for the panel's base URL, or a path starting with `/` (`"/search"`, `"/flows/:name"`). */
  path: string;
  handler: (request: DevtoolsPanelRequest) => unknown;
};

/**
 * A dashboard tab added through the devtools `panels` option.
 *
 * The tab shows `title`. Clicking it loads `view`, a browser ES module that
 * devtools serves at `<path>/panels/<id>/view.js`; its default export renders
 * the panel and calls the panel's `routes`.
 */
export type DevtoolsPanel = {
  /** Lower-case letters, digits and dashes, starting with a letter. Names the tab, the URL segment and the hash route. */
  id: string;
  /** The tab label. */
  title: string;
  /** The view module: an absolute file path or a `file:` URL. */
  view: string | URL;
  /** Data routes the view calls. */
  routes?: readonly DevtoolsPanelRoute[];
  /**
   * Whether the panel is safe to show in the production monitor. Without it
   * the panel is left out in production unless the project sets
   * `production.panels[<id>]: true`. In production its GET routes are open to
   * viewers and every other method to admins only (with the CSRF check and an
   * audit entry).
   *
   * @default false
   */
  production?: boolean;
  /**
   * More files the view loads, by served name: `{ "graph.js": "/abs/graph.js" }`
   * is served at `<path>/panels/<id>/graph.js`, so the view can
   * `import "./graph.js"`. Names are plain file names (no folders).
   */
  assets?: Readonly<Record<string, string | URL>>;
  /**
   * A folder of images the view shows, served at
   * `<path>/panels/<id>/files/<path inside the folder>`. Only the listed
   * extensions are served; a path that leaves the folder answers 404.
   */
  files?: DevtoolsPanelFiles;
  /**
   * What a read-only share link of the panel opens (production monitor with
   * `production.share.enabled`). Without it the panel cannot be shared.
   */
  share?: DevtoolsPanelShare;
};

/** A panel's folder of images (`DevtoolsPanel.files`). */
export type DevtoolsPanelFiles = {
  /** The folder: an absolute path or a `file:` URL. A missing folder serves nothing. */
  dir: string | URL;
  /**
   * Lower-case extensions served.
   *
   * @default [".png", ".jpg", ".jpeg", ".webp", ".gif"]
   */
  extensions?: readonly string[];
};

/** What a share link of a panel opens (`DevtoolsPanel.share`). */
export type DevtoolsPanelShare = {
  /**
   * The view module of the shared page: a browser ES module whose default
   * export renders like `view`, called with `context.shared === true`.
   */
  view: string | URL;
  /**
   * Paths of the panel's GET routes the shared page may call, as written in
   * `routes` (`"/product"`, `"/product/features/:feature"`). Every other
   * route answers 404 through a share link.
   */
  routes: readonly string[];
  /** Served names from `assets` the shared page may load. @default [] */
  assets?: readonly string[];
  /** Whether the shared page may load images from `files`. @default false */
  files?: boolean;
};

/**
 * One error group as a panel sees it: counts only, no message or stack
 * (`DevtoolsPanelFactoryContext.errors`).
 */
export type DevtoolsPanelErrorSummary = {
  /** The route pattern the error happened on (`/products/:id`), or `null` outside a request. */
  route: string | null;
  status: number | null;
  /** The error class name when known (`TypeError`). */
  name: string | null;
  source: "request" | "log";
  count: number;
  firstSeen: number;
  lastSeen: number;
};

/** One `panels` entry: a module specifier, a ready panel, or `[specifier, options]` to pass options to the module's factory. */
export type DevtoolsPanelEntry =
  | string
  | DevtoolsPanel
  | readonly [specifier: string, options: Readonly<Record<string, unknown>>];

/** What a panel factory receives. */
export type DevtoolsPanelFactoryContext = {
  // A `[specifier, options]` entry adds its options to this object; `root` and `mode` always win.
  /** The app's root directory. */
  root: string;
  /**
   * Where the dashboard runs. In `production` a panel must not write files
   * or run anything costly per request. Absent means `development`.
   */
  mode?: DevtoolsMode;
  /**
   * The captured error groups of the last hour (every instance in
   * production), counts only. Absent when the monitor captures no errors.
   */
  errors?: () => Promise<readonly DevtoolsPanelErrorSummary[]>;
};

/** One panel or several. */
export type DevtoolsPanels = DevtoolsPanel | readonly DevtoolsPanel[];

/**
 * The default export of a module listed in the devtools `panels` option: a
 * panel, a list of panels, or a function (sync or async) that returns either.
 */
export type DevtoolsPanelExport =
  | DevtoolsPanels
  | ((context: DevtoolsPanelFactoryContext) => DevtoolsPanels | Promise<DevtoolsPanels>);

/** A source file position, as shown next to an N+1 warning. */
export type DevtoolsCallerLocation = {
  /** Absolute path, forward slashes. */
  file: string;
  line: number;
  column: number;
};

/** One timed phase of a request (router middleware, loader, render, …). */
export type DevtoolsPhase = {
  name: string;
  startedAt: number;
  durationMs: number;
  attrs?: Record<string, unknown>;
};

/** One database query, Postgres or Mongo. */
export type DevtoolsQuery = {
  /** Unique within the collector. */
  id: string;
  connection: string;
  driver: "postgres" | "mongodb";
  sql?: string;
  /** Redacted through the logger's redaction rules before storage. */
  bindings?: unknown[];
  collection?: string;
  command?: string;
  pipeline?: unknown;
  startedAt: number;
  durationMs: number;
  rowCount?: number;
  /** The error message when the query failed. */
  error?: string;
  /**
   * The query with its values stripped — SQL text without bindings, or the
   * Mongo command with every leaf value replaced by `?`. Two queries with the
   * same shape are "the same query" for N+1 detection.
   */
  shape: string;
  /** The first application frame that issued the query, when resolvable. */
  caller?: DevtoolsCallerLocation;
};

/** One cache operation. */
export type DevtoolsCacheOperation = {
  type: "hit" | "miss" | "set" | "removed" | "invalidated" | "flushed";
  driver: string;
  key?: string;
  tags?: string[];
  keys?: string[];
  at: number;
  durationMs?: number;
};

/** One log entry. */
export type DevtoolsLogEntry = {
  level: "debug" | "info" | "warn" | "error" | "success";
  module: string;
  action: string;
  message: string;
  at: number;
  /** Redacted through the logger's redaction rules before storage. */
  context?: unknown;
};

/** A mail captured in development (see core's `mailEvents.onCaptured`). */
export type DevtoolsMail = {
  id: string;
  requestId?: string;
  capturedAt: number;
  from?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html?: string;
  text?: string;
  headers: Record<string, string>;
  attachments: DevtoolsMailAttachment[];
};

/** Attachment metadata only — the bytes are never stored. */
export type DevtoolsMailAttachment = {
  filename: string;
  contentType?: string;
  size?: number;
};

/** A problem devtools noticed about a request. */
export type DevtoolsWarning = {
  type: "n+1";
  message: string;
  shape: string;
  count: number;
  caller?: DevtoolsCallerLocation;
};

/** Everything recorded for one HTTP request. */
export type DevtoolsRequest = {
  /** The framework's `request.id`. */
  id: string;
  method: string;
  path: string;
  /** Matched route pattern, e.g. `/posts/:slug`. */
  route?: string;
  status?: number;
  startedAt: number;
  /** Undefined while the request is still in flight. */
  durationMs?: number;
  error?: string;
  phases: DevtoolsPhase[];
  queries: DevtoolsQuery[];
  cache: DevtoolsCacheOperation[];
  logs: DevtoolsLogEntry[];
  /** Ids of mails captured during this request (see `DevtoolsMail`). */
  mails: string[];
  warnings: DevtoolsWarning[];
};

/** The row the request list shows; `GET <path>/api/requests` returns these. */
export type DevtoolsRequestSummary = {
  id: string;
  method: string;
  path: string;
  route?: string;
  status?: number;
  startedAt: number;
  durationMs?: number;
  queryCount: number;
  warningCount: number;
  /** Read from the persisted request log only: the request is no longer in memory. */
  persisted?: true;
  /** The instance that served the request (production monitor). */
  instance?: string;
  /** Kept because it was slow or failed, without a timeline: the request was not sampled (production monitor). */
  partial?: true;
};

/**
 * `GET <path>/api/requests/:id`: the in-memory record, or one rebuilt from
 * the persisted request log. `record` is the log's full record (redacted
 * headers and body, response, error with stack) when one was written.
 */
export type DevtoolsRequestDetail = DevtoolsRequest & {
  persisted?: true;
  record?: RequestLogRecord;
};

/** The row the mailbox list shows; `GET <path>/api/mails` returns these. */
export type DevtoolsMailSummary = {
  id: string;
  requestId?: string;
  capturedAt: number;
  to: string[];
  subject: string;
};

/**
 * Work that happened outside any request (boot, a scheduler tick, a queue
 * job): kept separately so it never pollutes a request's timeline.
 */
export type DevtoolsBackground = {
  queries: DevtoolsQuery[];
  cache: DevtoolsCacheOperation[];
  logs: DevtoolsLogEntry[];
};

/** Server-sent events on `GET <path>/api/stream`. */
export type DevtoolsStreamEvent =
  | {
      type: "hello";
      data: { mode: DevtoolsMode; instance: string | null; role: DevtoolsRole | null };
    }
  | { type: "request"; data: DevtoolsRequestSummary }
  | { type: "mail"; data: DevtoolsMailSummary }
  | { type: "log"; data: DevtoolsLogEntry }
  | { type: "ai"; data: DevtoolsAiEvent }
  | { type: "agent-trace"; data: DevtoolsAgentTraceEvent };

/** Unsubscribes a listener or detaches a source. */
export type DevtoolsDisposer = () => void;

/**
 * The in-memory store every source writes to and the dashboard API reads
 * from. `requestId` is the framework's `request.id`; `undefined` means the
 * work happened outside a request and goes to the background bucket.
 */
export type DevtoolsCollector = {
  startRequest(request: {
    id: string;
    method: string;
    path: string;
    route?: string;
    startedAt: number;
  }): void;
  /** Settles the request, runs N+1 detection and emits a `request` stream event. */
  endRequest(
    id: string,
    result: { status?: number; durationMs: number; error?: string; route?: string },
  ): void;
  addPhase(requestId: string, phase: DevtoolsPhase): void;
  /** Computes `id` and `shape` itself. */
  addQuery(
    requestId: string | undefined,
    query: Omit<DevtoolsQuery, "id" | "shape">,
  ): DevtoolsQuery;
  addCacheOperation(requestId: string | undefined, operation: DevtoolsCacheOperation): void;
  addLog(requestId: string | undefined, entry: DevtoolsLogEntry): void;
  addMail(mail: DevtoolsMail): void;
  listRequests(): DevtoolsRequestSummary[];
  getRequest(id: string): DevtoolsRequest | undefined;
  listMails(): DevtoolsMailSummary[];
  getMail(id: string): DevtoolsMail | undefined;
  listLogs(filter?: { level?: DevtoolsLogEntry["level"]; module?: string }): DevtoolsLogEntry[];
  getBackground(): DevtoolsBackground;
  subscribe(listener: (event: DevtoolsStreamEvent) => void): DevtoolsDisposer;
  clear(): void;
};
