/**
 * The records the devtools collector keeps and the dashboard API returns.
 *
 * Every timestamp is epoch milliseconds (fractional allowed); every duration
 * is milliseconds. Nothing here is persisted — the collector is an in-memory
 * ring buffer that is lost on restart.
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
};

/** `DevtoolsOptions` with every default applied. */
export type ResolvedDevtoolsOptions = Required<DevtoolsOptions>;

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
  | { type: "request"; data: DevtoolsRequestSummary }
  | { type: "mail"; data: DevtoolsMailSummary }
  | { type: "log"; data: DevtoolsLogEntry };

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
