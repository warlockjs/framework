import type {
  DevtoolsBackground,
  DevtoolsCacheOperation,
  DevtoolsCollector,
  DevtoolsDisposer,
  DevtoolsLogEntry,
  DevtoolsMail,
  DevtoolsMailSummary,
  DevtoolsPhase,
  DevtoolsQuery,
  DevtoolsRequest,
  DevtoolsRequestSummary,
  DevtoolsStreamEvent,
  ResolvedDevtoolsOptions,
} from "./types";
import { detectNPlusOne } from "./n-plus-one";
import { queryShape } from "./query-shape";

const mailLimit = 100;
const logLimit = 1000;
const backgroundLimit = 500;

/**
 * Creates the in-memory devtools store.
 *
 * Read methods return shallow structural copies, including copied arrays, so consumers
 * cannot mutate collector-owned arrays. The individual nested entries are retained.
 */
export function createCollector(options: ResolvedDevtoolsOptions): DevtoolsCollector {
  const requests = new Map<string, DevtoolsRequest>();
  const mails = new Map<string, DevtoolsMail>();
  const logs: DevtoolsLogEntry[] = [];
  const background: DevtoolsBackground = { queries: [], cache: [], logs: [] };
  const listeners = new Set<(event: DevtoolsStreamEvent) => void>();
  let querySequence = 0;

  const emit = (event: DevtoolsStreamEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* Subscribers must not affect collection. */
      }
    }
  };

  const addBackground = <T>(list: T[], value: T) => {
    list.push(value);
    if (list.length > backgroundLimit) list.shift();
  };

  return {
    startRequest(request) {
      requests.delete(request.id);
      requests.set(request.id, {
        ...request,
        phases: [],
        queries: [],
        cache: [],
        logs: [],
        mails: [],
        warnings: [],
      });
      while (requests.size > options.maxRequests)
        requests.delete(requests.keys().next().value as string);
    },
    endRequest(id, result) {
      const request = requests.get(id);
      if (!request) return;
      request.status = result.status;
      request.durationMs = result.durationMs;
      request.error = result.error;
      if (result.route !== undefined) request.route = result.route;
      request.warnings = detectNPlusOne(request.queries, options.nPlusOneThreshold);
      emit({ type: "request", data: summary(request) });
    },
    addPhase(requestId, phase) {
      requests.get(requestId)?.phases.push(phase);
    },
    addQuery(requestId, query) {
      const stored: DevtoolsQuery = {
        ...query,
        id: `q${++querySequence}`,
        shape: queryShape(query),
      };
      const request = requestId ? requests.get(requestId) : undefined;
      if (request) request.queries.push(stored);
      else addBackground(background.queries, stored);
      return stored;
    },
    addCacheOperation(requestId, operation) {
      const request = requestId ? requests.get(requestId) : undefined;
      if (request) request.cache.push(operation);
      else addBackground(background.cache, operation);
    },
    addLog(requestId, entry) {
      const request = requestId ? requests.get(requestId) : undefined;
      if (request) request.logs.push(entry);
      else addBackground(background.logs, entry);
      logs.unshift(entry);
      if (logs.length > logLimit) logs.pop();
      emit({ type: "log", data: entry });
    },
    addMail(mail) {
      mails.delete(mail.id);
      mails.set(mail.id, mail);
      while (mails.size > mailLimit) mails.delete(mails.keys().next().value as string);
      if (mail.requestId) requests.get(mail.requestId)?.mails.push(mail.id);
      emit({ type: "mail", data: mailSummary(mail) });
    },
    listRequests() {
      return [...requests.values()].reverse().map(summary);
    },
    getRequest(id) {
      const request = requests.get(id);
      return request && copyRequest(request);
    },
    listMails() {
      return [...mails.values()].reverse().map(mailSummary);
    },
    getMail(id) {
      const mail = mails.get(id);
      return (
        mail && {
          ...mail,
          to: [...mail.to],
          cc: [...mail.cc],
          bcc: [...mail.bcc],
          headers: { ...mail.headers },
          attachments: [...mail.attachments],
        }
      );
    },
    listLogs(filter = {}) {
      const module = filter.module?.toLowerCase();
      return logs
        .filter(
          (entry) =>
            (!filter.level || entry.level === filter.level) &&
            (!module || entry.module.toLowerCase().includes(module)),
        )
        .map((entry) => ({ ...entry }));
    },
    getBackground() {
      return {
        queries: [...background.queries],
        cache: [...background.cache],
        logs: [...background.logs],
      };
    },
    subscribe(listener): DevtoolsDisposer {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      requests.clear();
      mails.clear();
      logs.length = 0;
      background.queries.length = 0;
      background.cache.length = 0;
      background.logs.length = 0;
    },
  };
}

function summary(request: DevtoolsRequest): DevtoolsRequestSummary {
  const { id, method, path, route, status, startedAt, durationMs } = request;
  return {
    id,
    method,
    path,
    route,
    status,
    startedAt,
    durationMs,
    queryCount: request.queries.length,
    warningCount: request.warnings.length,
  };
}

function mailSummary(mail: DevtoolsMail): DevtoolsMailSummary {
  const { id, requestId, capturedAt, to, subject } = mail;
  return { id, requestId, capturedAt, to: [...to], subject };
}

function copyRequest(request: DevtoolsRequest): DevtoolsRequest {
  return {
    ...request,
    phases: [...request.phases],
    queries: [...request.queries],
    cache: [...request.cache],
    logs: [...request.logs],
    mails: [...request.mails],
    warnings: [...request.warnings],
  };
}
