import { WarlockError } from "../../errors/warlock-error";
import { DEV_SERVER_STATE_FILE, readDevServerState } from "../dev-state/dev-server-state";

/**
 * A client for the JSON API `@warlock.js/devtools` mounts on the running dev
 * server (`GET <path>/api/requests`, `GET <path>/api/requests/:id`).
 *
 * Shapes are mirrored structurally rather than imported: devtools is an
 * optional dev dependency, and this module must load without it.
 */

/** The devtools mount every app uses unless it wired devtools by hand. */
export const DEFAULT_DEVTOOLS_PATH = "/__warlock";

/** The `fetch` this client calls; injectable for tests. */
export type DevtoolsFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One timed phase: `route.match`, `middleware` (with `attrs.name`), `validation`, `handler`. */
export type DevtoolsPhaseRecord = {
  name: string;
  startedAt: number;
  durationMs: number;
  attrs?: Record<string, unknown>;
};

/** The row `GET <path>/api/requests` returns. */
export type DevtoolsRequestSummaryRecord = {
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

/** Everything devtools recorded for one request (`GET <path>/api/requests/:id`). */
export type DevtoolsRequestRecord = {
  id: string;
  method: string;
  path: string;
  route?: string;
  status?: number;
  startedAt: number;
  /** Absent while the request is still in flight. */
  durationMs?: number;
  error?: string;
  phases: DevtoolsPhaseRecord[];
  /** Queries: `sql`/`collection`, `durationMs`, `shape`, `caller`, `error`. */
  queries: Record<string, unknown>[];
  cache: Record<string, unknown>[];
  logs: Record<string, unknown>[];
  mails: string[];
  /** `{ type: "n+1", message, shape, count, caller }` entries. */
  warnings: Record<string, unknown>[];
};

/** Where the dev server and its devtools API live. */
export type DevtoolsEndpoint = {
  /** The dev server origin, e.g. `http://localhost:2030`. */
  url: string;
  /** The devtools mount, e.g. `/__warlock`. */
  devtoolsPath: string;
};

/** Options of {@link connectDevtools}. */
export type ConnectDevtoolsOptions = {
  /** Project root, where `.warlock/dev-server.json` is read. Default: `process.cwd()`. */
  cwd?: string;
  /** The dev server address; overrides the recorded one. */
  url?: string;
  /** The devtools mount; overrides the recorded one. */
  devtoolsPath?: string;
  fetch?: DevtoolsFetch;
};

/** A connected devtools API. */
export type DevtoolsClient = DevtoolsEndpoint & {
  /** The summaries devtools holds, newest last (the order the collector keeps). */
  listRequests(): Promise<DevtoolsRequestSummaryRecord[]>;
  /** One request's full record, or `undefined` when devtools does not hold it. */
  getRequest(id: string): Promise<DevtoolsRequestRecord | undefined>;
  /**
   * Poll until the request is recorded AND settled (`durationMs` set), or the
   * timeout passes. On timeout, resolves the last record seen (still without
   * `durationMs`), or `undefined` when devtools never recorded the request.
   */
  waitForRequest(
    id: string,
    options?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<DevtoolsRequestRecord | undefined>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Narrow one summary row; `undefined` when it is not one. */
export function parseRequestSummary(value: unknown): DevtoolsRequestSummaryRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || typeof value.method !== "string") return undefined;
  if (typeof value.path !== "string") return undefined;

  return {
    id: value.id,
    method: value.method,
    path: value.path,
    route: optionalString(value.route),
    status: optionalNumber(value.status),
    startedAt: optionalNumber(value.startedAt) ?? 0,
    durationMs: optionalNumber(value.durationMs),
    queryCount: optionalNumber(value.queryCount) ?? 0,
    warningCount: optionalNumber(value.warningCount) ?? 0,
  };
}

/** Narrow a full request record; `undefined` when it is not one. */
export function parseRequestRecord(value: unknown): DevtoolsRequestRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || typeof value.method !== "string") return undefined;
  if (typeof value.path !== "string") return undefined;

  const phases: DevtoolsPhaseRecord[] = records(value.phases).flatMap((phase) =>
    typeof phase.name === "string"
      ? [
          {
            name: phase.name,
            startedAt: optionalNumber(phase.startedAt) ?? 0,
            durationMs: optionalNumber(phase.durationMs) ?? 0,
            ...(isRecord(phase.attrs) ? { attrs: phase.attrs } : {}),
          },
        ]
      : [],
  );

  return {
    id: value.id,
    method: value.method,
    path: value.path,
    route: optionalString(value.route),
    status: optionalNumber(value.status),
    startedAt: optionalNumber(value.startedAt) ?? 0,
    durationMs: optionalNumber(value.durationMs),
    error: optionalString(value.error),
    phases,
    queries: records(value.queries),
    cache: records(value.cache),
    logs: records(value.logs),
    mails: Array.isArray(value.mails)
      ? value.mails.filter((mail): mail is string => typeof mail === "string")
      : [],
    warnings: records(value.warnings),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    const code = isRecord(cause) && typeof cause.code === "string" ? ` (${cause.code})` : "";

    return `${error.message}${code}`;
  }

  return String(error);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Where the dev server is: the explicit option, else `.warlock/dev-server.json`. Throws `WL8008`. */
export function resolveDevServerEndpoint(options: ConnectDevtoolsOptions = {}): DevtoolsEndpoint {
  const state = options.url === undefined ? readDevServerState(options.cwd) : undefined;
  const url = options.url ?? state?.url;

  if (!url) {
    throw new WarlockError(
      "WL8008",
      `No running dev server is recorded in ${DEV_SERVER_STATE_FILE}. Start \`warlock dev\` in this project, or pass --url.`,
    );
  }

  const devtoolsPath = trimSlash(
    options.devtoolsPath ?? state?.devtools?.path ?? DEFAULT_DEVTOOLS_PATH,
  );

  return { url: trimSlash(url), devtoolsPath };
}

/**
 * Connect to the devtools API of the running dev server.
 *
 * Throws `WL8008` when no dev server is recorded or it does not answer, and
 * `WL8009` when it answers but devtools is not mounted (404, or anything that
 * is not the devtools JSON).
 */
export async function connectDevtools(
  options: ConnectDevtoolsOptions = {},
): Promise<DevtoolsClient> {
  const endpoint = resolveDevServerEndpoint(options);
  const fetcher: DevtoolsFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const api = `${endpoint.url}${endpoint.devtoolsPath}/api`;

  const getJson = async (url: string): Promise<{ status: number; body: unknown }> => {
    let response: Response;

    try {
      response = await fetcher(url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new WarlockError(
        "WL8008",
        `The dev server at ${endpoint.url} is not reachable: ${errorMessage(error)}. Start \`warlock dev\`, or pass --url.`,
        { cause: error },
      );
    }

    const text = await response.text();
    let body: unknown;

    try {
      body = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    return { status: response.status, body };
  };

  const probe = await getJson(`${api}/requests`);

  if (probe.status !== 200 || !Array.isArray(probe.body)) {
    throw new WarlockError(
      "WL8009",
      `The dev server at ${endpoint.url} answered ${probe.status} on ${endpoint.devtoolsPath}/api/requests: devtools is not running there. Install it with \`warlock add devtools\` and restart \`warlock dev\`.`,
    );
  }

  const client: DevtoolsClient = {
    ...endpoint,
    async listRequests() {
      const { body } = await getJson(`${api}/requests`);

      return Array.isArray(body)
        ? body.flatMap((row) => {
            const summary = parseRequestSummary(row);
            return summary ? [summary] : [];
          })
        : [];
    },
    async getRequest(id) {
      const { status, body } = await getJson(`${api}/requests/${encodeURIComponent(id)}`);

      return status === 200 ? parseRequestRecord(body) : undefined;
    },
    async waitForRequest(id, waitOptions = {}) {
      const timeoutMs = waitOptions.timeoutMs ?? 5_000;
      const intervalMs = waitOptions.intervalMs ?? 50;
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const record = await client.getRequest(id);

        if (record && record.durationMs !== undefined) return record;
        if (Date.now() >= deadline) return record;

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  };

  return client;
}
