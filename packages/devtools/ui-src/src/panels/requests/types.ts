import type { DevtoolsSampleDetail, DevtoolsSampleSummary } from "@contracts";

/** A row of `GET api/requests`: the same shape in both modes. */
export type RequestRow = DevtoolsSampleSummary;

/** The parts of core's persisted request record the detail shows. */
export type RequestRecord = {
  headers?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  session?: unknown;
  ip?: string;
  status?: number;
  response?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    phase?: string;
    file?: string;
    site?: string;
  };
  queries?: { count: number; nPlusOne?: unknown[] } & Record<string, unknown>;
};

/** A development query (full SQL, bindings) or a production one (shape only). */
export type DetailQuery = {
  id: string;
  connection: string;
  driver: "postgres" | "mongodb";
  sql?: string;
  bindings?: unknown[];
  collection?: string;
  command?: string;
  pipeline?: unknown;
  shape?: string;
  shapeId?: string;
  startedAt: number;
  durationMs: number;
  rowCount?: number;
  error?: string;
};

export type DetailCacheOperation = {
  type: string;
  driver?: string;
  key?: string;
  keys?: string[];
  at: number;
  durationMs?: number;
};

export type DetailWarning = {
  type: "n+1";
  message: string;
  shape: string;
  count: number;
  caller?: { file: string; line: number; column: number };
};

/**
 * `GET api/requests/:id`. Development returns the in-memory record (cache is
 * a list of operations); production returns a stored sample (cache is counts)
 * or a rebuilt request log record.
 */
export type RequestDetail = Omit<
  DevtoolsSampleDetail,
  "queries" | "cache" | "warnings" | "logs"
> & {
  queries: DetailQuery[];
  cache: DetailCacheOperation[] | DevtoolsSampleDetail["cache"];
  warnings: DetailWarning[];
  logs: {
    level: string;
    module: string;
    action: string;
    message: string;
    at: number;
    context?: unknown;
  }[];
  mails?: string[];
  record?: RequestRecord;
};
