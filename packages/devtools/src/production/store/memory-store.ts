import { randomUUID } from "node:crypto";
import type {
  DevtoolsAuditEntry,
  DevtoolsInstanceReport,
  DevtoolsSampleSummary,
} from "../contracts";
import { DevtoolsStoreConflictError } from "../errors";
import type {
  DevtoolsAccountRecord,
  DevtoolsInviteRecord,
  DevtoolsSampleFilter,
  DevtoolsSessionRecord,
  DevtoolsStateRecord,
  DevtoolsStore,
  DevtoolsStoredSample,
} from "./types";

/** A structural copy, so callers never hold the store's own objects. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/** The state row before anything was written. */
export function defaultStateRecord(now = 0): DevtoolsStateRecord {
  return {
    disabled: false,
    disabledPathHash: null,
    disabledAt: null,
    disabledBy: null,
    lockedUntil: null,
    failuresResetAt: null,
    updatedAt: now,
    version: 0,
  };
}

/** Whether `status` matches a sample filter value: `"5xx"`, `"4xx"`, `"404"`. */
export function sampleStatusMatches(filter: string, status: number | undefined): boolean {
  if (status === undefined) return false;

  const value = filter.trim().toLowerCase();

  if (/^[1-5]xx$/.test(value)) return Math.floor(status / 100) === Number(value[0]);

  return String(status) === value;
}

/** Whether a sample summary passes `filter` (everything but `limit`). */
export function sampleMatches(
  summary: DevtoolsSampleSummary,
  filter: DevtoolsSampleFilter,
): boolean {
  if (filter.status !== undefined && !sampleStatusMatches(filter.status, summary.status))
    return false;
  if (filter.method !== undefined && summary.method.toUpperCase() !== filter.method.toUpperCase()) {
    return false;
  }

  if (filter.route !== undefined) {
    const needle = filter.route.toLowerCase();
    const haystack = `${summary.route ?? ""} ${summary.path}`.toLowerCase();

    if (!haystack.includes(needle)) return false;
  }

  if (filter.q !== undefined && !summary.path.toLowerCase().includes(filter.q.toLowerCase())) {
    return false;
  }

  if (filter.since !== undefined && summary.startedAt < filter.since) return false;
  if (filter.until !== undefined && summary.startedAt > filter.until) return false;
  if (filter.instance !== undefined && summary.instance !== filter.instance) return false;

  return true;
}

/**
 * An in-process `DevtoolsStore` for specs (and nothing else: it is neither
 * shared between processes nor kept across restarts). It follows the store
 * contract exactly, compare-and-set included, so a spec written against it
 * holds for the database store too.
 *
 * `now` is read for `updatedAt` stamps; pass a fake clock in specs.
 */
export function createMemoryStore(options: { now?: () => number } = {}): DevtoolsStore {
  const now = options.now ?? Date.now;
  const accounts = new Map<string, DevtoolsAccountRecord>();
  const sessions = new Map<string, DevtoolsSessionRecord>();
  const invites = new Map<string, DevtoolsInviteRecord>();
  const audit: DevtoolsAuditEntry[] = [];
  const samples = new Map<string, DevtoolsStoredSample>();
  const reports = new Map<string, DevtoolsInstanceReport>();
  let state: DevtoolsStateRecord | null = null;

  return {
    async verify() {},

    accounts: {
      async findByEmail(email) {
        for (const account of accounts.values()) {
          if (account.email === email) return copy(account);
        }

        return null;
      },
      async findById(id) {
        const account = accounts.get(id);

        return account ? copy(account) : null;
      },
      async list() {
        return [...accounts.values()].sort((a, b) => a.createdAt - b.createdAt).map(copy);
      },
      async countAdmins() {
        return [...accounts.values()].filter((account) => account.role === "admin").length;
      },
      async create(input) {
        for (const account of accounts.values()) {
          if (account.email === input.email) throw new DevtoolsStoreConflictError("email");
        }

        const at = now();
        const record: DevtoolsAccountRecord = {
          ...copy(input),
          id: randomUUID(),
          createdAt: at,
          updatedAt: at,
          version: 1,
        };

        accounts.set(record.id, record);

        return copy(record);
      },
      async update(id, expectedVersion, patch) {
        const current = accounts.get(id);

        if (!current || current.version !== expectedVersion) return null;

        if (patch.email !== undefined && patch.email !== current.email) {
          for (const account of accounts.values()) {
            if (account.email === patch.email) throw new DevtoolsStoreConflictError("email");
          }
        }

        const next: DevtoolsAccountRecord = {
          ...current,
          ...copy(patch),
          id,
          createdAt: current.createdAt,
          updatedAt: now(),
          version: current.version + 1,
        };

        accounts.set(id, next);

        return copy(next);
      },
      async remove(id) {
        return accounts.delete(id);
      },
    },

    sessions: {
      async create(input) {
        const record: DevtoolsSessionRecord = { ...copy(input), id: randomUUID(), version: 1 };

        sessions.set(record.id, record);

        return copy(record);
      },
      async findByTokenHash(tokenHash) {
        for (const session of sessions.values()) {
          if (session.tokenHash === tokenHash) return copy(session);
        }

        return null;
      },
      async listForAccount(accountId) {
        return [...sessions.values()]
          .filter((session) => session.accountId === accountId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(copy);
      },
      async update(id, expectedVersion, patch) {
        const current = sessions.get(id);

        if (!current || current.version !== expectedVersion) return null;

        const next: DevtoolsSessionRecord = {
          ...current,
          ...copy(patch),
          id,
          accountId: current.accountId,
          version: current.version + 1,
        };

        sessions.set(id, next);

        return copy(next);
      },
      async remove(id) {
        return sessions.delete(id);
      },
      async removeForAccount(accountId, exceptId) {
        let removed = 0;

        for (const session of [...sessions.values()]) {
          if (session.accountId === accountId && session.id !== exceptId) {
            sessions.delete(session.id);
            removed++;
          }
        }

        return removed;
      },
      async removeExpired(at) {
        let removed = 0;

        for (const session of [...sessions.values()]) {
          if (session.expiresAt < at) {
            sessions.delete(session.id);
            removed++;
          }
        }

        return removed;
      },
    },

    invites: {
      async create(input) {
        const record: DevtoolsInviteRecord = {
          ...copy(input),
          id: randomUUID(),
          usedAt: null,
          accountId: null,
        };

        invites.set(record.id, record);

        return copy(record);
      },
      async findByTokenHash(tokenHash) {
        for (const invite of invites.values()) {
          if (invite.tokenHash === tokenHash) return copy(invite);
        }

        return null;
      },
      async list(listOptions = {}) {
        return [...invites.values()]
          .filter((invite) => listOptions.includeUsed === true || invite.usedAt === null)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(copy);
      },
      async markUsed(id, at, accountId) {
        const invite = invites.get(id);

        if (!invite || invite.usedAt !== null || at >= invite.expiresAt) return false;

        invites.set(id, { ...invite, usedAt: at, accountId });

        return true;
      },
      async remove(id) {
        return invites.delete(id);
      },
      async removeExpired(at) {
        let removed = 0;

        for (const invite of [...invites.values()]) {
          if (invite.usedAt === null && invite.expiresAt < at) {
            invites.delete(invite.id);
            removed++;
          }
        }

        return removed;
      },
    },

    audit: {
      async append(entry) {
        const record: DevtoolsAuditEntry = { ...copy(entry), id: randomUUID() };

        audit.push(record);

        return copy(record);
      },
      async list(filter) {
        const limit = Math.max(1, Math.min(500, filter.limit));

        return audit
          .filter(
            (entry) =>
              (filter.types === undefined || filter.types.includes(entry.type)) &&
              (filter.accountId === undefined || entry.accountId === filter.accountId) &&
              (filter.before === undefined || entry.at < filter.before),
          )
          .sort((a, b) => b.at - a.at)
          .slice(0, limit)
          .map(copy);
      },
      async count(filter) {
        return audit.filter(
          (entry) =>
            filter.types.includes(entry.type) &&
            entry.at >= filter.since &&
            (filter.accountId === undefined || entry.accountId === filter.accountId) &&
            (filter.ip === undefined || entry.ip === filter.ip),
        ).length;
      },
      async prune(before) {
        const kept = audit.filter((entry) => entry.at >= before);
        const removed = audit.length - kept.length;

        audit.splice(0, audit.length, ...kept);

        return removed;
      },
    },

    state: {
      async read() {
        return copy(state ?? defaultStateRecord(now()));
      },
      async update(expectedVersion, patch) {
        const current = state ?? defaultStateRecord(now());

        if (current.version !== expectedVersion) return null;

        state = { ...current, ...copy(patch), updatedAt: now(), version: current.version + 1 };

        return copy(state);
      },
    },

    samples: {
      async insert(list) {
        for (const sample of list) samples.set(sample.id, copy(sample));
      },
      async list(filter) {
        const limit = Math.max(1, Math.min(1000, filter.limit));

        return [...samples.values()]
          .map((sample) => sample.summary)
          .filter((summary) => sampleMatches(summary, filter))
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, limit)
          .map(copy);
      },
      async get(id) {
        const sample = samples.get(id);

        return sample ? copy(sample) : null;
      },
      async prune(before) {
        let removed = 0;

        for (const sample of [...samples.values()]) {
          if (sample.startedAt < before) {
            samples.delete(sample.id);
            removed++;
          }
        }

        return removed;
      },
      async clear() {
        const removed = samples.size;

        samples.clear();

        return removed;
      },
    },

    reports: {
      async write(report) {
        reports.set(report.instance.id, copy(report));
      },
      async list(seenSince) {
        return [...reports.values()]
          .filter((report) => report.at >= seenSince)
          .sort((a, b) => b.at - a.at)
          .map(copy);
      },
      async prune(seenBefore) {
        let removed = 0;

        for (const report of [...reports.values()]) {
          if (report.at < seenBefore) {
            reports.delete(report.instance.id);
            removed++;
          }
        }

        return removed;
      },
      async remove(instanceId) {
        return reports.delete(instanceId);
      },
    },
  };
}
