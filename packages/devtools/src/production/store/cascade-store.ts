import { randomUUID } from "node:crypto";
import type { DevtoolsAuditEntry, DevtoolsInstanceReport } from "../contracts";
import { DevtoolsProductionConfigError, DevtoolsStoreConflictError } from "../errors";
import { rateLimitClient } from "../http/ip";
import {
  accountPatchToRow,
  accountToRow,
  auditToRow,
  inviteToRow,
  reportToRow,
  rowToAccount,
  rowToAudit,
  rowToInvite,
  rowToReport,
  rowToSample,
  rowToSampleSummary,
  rowToSession,
  rowToState,
  sampleToRow,
  sessionPatchToRow,
  sessionToRow,
  statePatchToRow,
  stateToRow,
  type Row,
} from "./mapping";
import { defaultStateRecord, sampleMatches } from "./memory-store";
import type {
  DevtoolsAccountRecord,
  DevtoolsInviteRecord,
  DevtoolsSessionRecord,
  DevtoolsStore,
} from "./types";

type ModelsModule = typeof import("./models");

/** The part of cascade's query builder this store uses. */
interface RowQuery {
  where(field: string, operator: string, value: unknown): RowQuery;
  whereIn(field: string, values: unknown[]): RowQuery;
  whereNull(field: string): RowQuery;
  orderBy(field: string, direction: "asc" | "desc"): RowQuery;
  limit(value: number): RowQuery;
  select(fields: string[]): RowQuery;
  get(): Promise<Row[]>;
  first(): Promise<Row | null>;
  delete(): Promise<number>;
  count(): Promise<number>;
}

/** The part of a cascade model class this store uses (every table class has this shape). */
type RowClass = ModelsModule["DevtoolsAccountRow"];

export type CascadeStoreOptions = {
  /** The clock for `updatedAt` stamps; defaults to `Date.now`. */
  now?: () => number;
};

/** The most rows scanned for a sample filter the database cannot apply (route, text). */
const SAMPLE_SCAN_LIMIT = 5000;

/** A plain-row query (no model instances). */
function rows(table: RowClass): RowQuery {
  return table.query().lean() as unknown as RowQuery;
}

/** A query for counting and deleting. */
function query(table: RowClass): RowQuery {
  return table.query() as unknown as RowQuery;
}

function byId(table: RowClass, id: string): Promise<Row | null> {
  return rows(table).where("id", "=", id).first();
}

async function insert(table: RowClass, row: Row): Promise<void> {
  await table.create(row as never);
}

async function removeWhere(table: RowClass, field: string, value: unknown): Promise<boolean> {
  return (await query(table).where(field, "=", value).delete()) > 0;
}

/** Applies `$set` to the row only while its `version` still equals `expected`. */
async function compareAndSet(
  table: RowClass,
  id: string,
  expected: number,
  set: Row,
): Promise<boolean> {
  const updated = await table.atomic({ id, version: expected }, { $set: set });

  return updated > 0;
}

/**
 * The production `DevtoolsStore`: the app's database through
 * `@warlock.js/cascade` (MongoDB or SQL), using the models in `./models` and
 * the tables `devtoolsMigrations` creates. Imports cascade lazily so loading
 * this module never requires it.
 *
 * Throws `DevtoolsProductionConfigError("DT005")` when cascade is not
 * installed or has no connection.
 */
export async function createCascadeStore(
  options: CascadeStoreOptions = {},
): Promise<DevtoolsStore> {
  const now = options.now ?? Date.now;
  let models: ModelsModule;

  try {
    models = await import("./models");
    // Throws when the app has no data source.
    models.DevtoolsAccountRow.getDataSource();
  } catch (error) {
    throw new DevtoolsProductionConfigError(
      "DT005",
      error instanceof Error ? `(${error.message})` : undefined,
    );
  }

  const {
    DevtoolsAccountRow: Accounts,
    DevtoolsSessionRow: Sessions,
    DevtoolsInviteRow: Invites,
    DevtoolsAuditRow: Audit,
    DevtoolsStateRow: State,
    DevtoolsSampleRow: Samples,
    DevtoolsReportRow: Reports,
  } = models;
  const tables: RowClass[] = [Accounts, Sessions, Invites, Audit, State, Samples, Reports];

  const accountById = async (id: string): Promise<DevtoolsAccountRecord | null> => {
    const row = await byId(Accounts, id);

    return row ? rowToAccount(row) : null;
  };
  const sessionById = async (id: string): Promise<DevtoolsSessionRecord | null> => {
    const row = await byId(Sessions, id);

    return row ? rowToSession(row) : null;
  };

  return {
    async verify() {
      const blueprint = Accounts.getDriver().blueprint;
      const missing: string[] = [];

      for (const table of tables) {
        if (!(await blueprint.tableExists(table.table))) missing.push(table.table);
      }

      if (missing.length > 0) {
        throw new DevtoolsProductionConfigError("DT008", `(missing: ${missing.join(", ")})`);
      }
    },

    accounts: {
      async findByEmail(email) {
        const row = await rows(Accounts).where("email", "=", email).first();

        return row ? rowToAccount(row) : null;
      },
      findById: accountById,
      async list() {
        const found = await rows(Accounts).orderBy("created_at", "asc").get();

        return found.map(rowToAccount);
      },
      async countAdmins() {
        return query(Accounts).where("role", "=", "admin").count();
      },
      async create(input) {
        const at = now();
        const record: DevtoolsAccountRecord = {
          ...structuredClone(input),
          id: randomUUID(),
          createdAt: at,
          updatedAt: at,
          version: 1,
        };

        if (await rows(Accounts).where("email", "=", record.email).first()) {
          throw new DevtoolsStoreConflictError("email");
        }

        try {
          await insert(Accounts, accountToRow(record));
        } catch (error) {
          // A concurrent request took the email between the check and the insert.
          if (await rows(Accounts).where("email", "=", record.email).first()) {
            throw new DevtoolsStoreConflictError("email");
          }

          throw error;
        }

        return record;
      },
      async update(id, expectedVersion, patch) {
        const current = await accountById(id);

        if (!current || current.version !== expectedVersion) return null;

        if (patch.email !== undefined && patch.email !== current.email) {
          if (await rows(Accounts).where("email", "=", patch.email).first()) {
            throw new DevtoolsStoreConflictError("email");
          }
        }

        const set = {
          ...accountPatchToRow(structuredClone(patch)),
          updated_at: now(),
          version: expectedVersion + 1,
        };
        let won: boolean;

        try {
          won = await compareAndSet(Accounts, id, expectedVersion, set);
        } catch (error) {
          if (
            patch.email !== undefined &&
            (await rows(Accounts).where("email", "=", patch.email).first())
          ) {
            throw new DevtoolsStoreConflictError("email");
          }

          throw error;
        }

        return won ? accountById(id) : null;
      },
      async remove(id) {
        return removeWhere(Accounts, "id", id);
      },
    },

    sessions: {
      async create(input) {
        const record: DevtoolsSessionRecord = {
          ...structuredClone(input),
          id: randomUUID(),
          version: 1,
        };

        await insert(Sessions, sessionToRow(record));

        return record;
      },
      async findByTokenHash(tokenHash) {
        const row = await rows(Sessions).where("token_hash", "=", tokenHash).first();

        return row ? rowToSession(row) : null;
      },
      async listForAccount(accountId) {
        const found = await rows(Sessions)
          .where("account_id", "=", accountId)
          .orderBy("created_at", "desc")
          .get();

        return found.map(rowToSession);
      },
      async update(id, expectedVersion, patch) {
        const set = { ...sessionPatchToRow(structuredClone(patch)), version: expectedVersion + 1 };

        if (!(await compareAndSet(Sessions, id, expectedVersion, set))) return null;

        return sessionById(id);
      },
      async remove(id) {
        return removeWhere(Sessions, "id", id);
      },
      async removeForAccount(accountId, exceptId) {
        const target = query(Sessions).where("account_id", "=", accountId);

        if (exceptId !== undefined) target.where("id", "!=", exceptId);

        return target.delete();
      },
      async removeExpired(at) {
        return query(Sessions).where("expires_at", "<", at).delete();
      },
    },

    invites: {
      async create(input) {
        const record: DevtoolsInviteRecord = {
          ...structuredClone(input),
          id: randomUUID(),
          usedAt: null,
          accountId: null,
        };

        await insert(Invites, inviteToRow(record));

        return record;
      },
      async findByTokenHash(tokenHash) {
        const row = await rows(Invites).where("token_hash", "=", tokenHash).first();

        return row ? rowToInvite(row) : null;
      },
      async list(listOptions = {}) {
        const target = rows(Invites);

        if (listOptions.includeUsed !== true) target.whereNull("used_at");

        return (await target.orderBy("created_at", "desc").get()).map(rowToInvite);
      },
      async markUsed(id, at, accountId) {
        const updated = await Invites.atomic(
          { id, used_at: null, expires_at: { $gt: at } },
          { $set: { used_at: at, account_id: accountId } },
          // Code-authored filter; nothing here comes from a request.
          { trustedFilter: true },
        );

        return updated > 0;
      },
      async remove(id) {
        return removeWhere(Invites, "id", id);
      },
      async removeExpired(at) {
        return query(Invites).whereNull("used_at").where("expires_at", "<", at).delete();
      },
    },

    audit: {
      async append(entry) {
        const record: DevtoolsAuditEntry = { ...structuredClone(entry), id: randomUUID() };

        await insert(Audit, auditToRow(record));

        return record;
      },
      async list(filter) {
        const limit = Math.max(1, Math.min(500, filter.limit));
        const target = rows(Audit);

        if (filter.types !== undefined) target.whereIn("type", [...filter.types]);
        if (filter.accountId !== undefined) target.where("account_id", "=", filter.accountId);
        if (filter.before !== undefined) target.where("occurred_at", "<", filter.before);

        const found = await target.orderBy("occurred_at", "desc").limit(limit).get();

        return found.map(rowToAudit);
      },
      async count(filter) {
        const target = query(Audit)
          .whereIn("type", [...filter.types])
          .where("occurred_at", ">=", filter.since);

        if (filter.accountId !== undefined) target.where("account_id", "=", filter.accountId);
        if (filter.ip !== undefined) target.where("ip_bucket", "=", rateLimitClient(filter.ip));

        return target.count();
      },
      async prune(before) {
        return query(Audit).where("occurred_at", "<", before).delete();
      },
    },

    state: {
      async read() {
        const row = await byId(State, "state");

        return row ? rowToState(row) : defaultStateRecord(now());
      },
      async update(expectedVersion, patch) {
        const row = await byId(State, "state");

        if (!row) {
          if (expectedVersion !== 0) return null;

          const record = {
            ...defaultStateRecord(now()),
            ...structuredClone(patch),
            updatedAt: now(),
            version: 1,
          };

          try {
            await insert(State, { id: "state", ...stateToRow(record) });
          } catch {
            // Another process wrote the first row; this write lost the race.
            return null;
          }

          return record;
        }

        const set = {
          ...statePatchToRow(structuredClone(patch)),
          updated_at: now(),
          version: expectedVersion + 1,
        };

        if (!(await compareAndSet(State, "state", expectedVersion, set))) return null;

        const next = await byId(State, "state");

        return next ? rowToState(next) : null;
      },
    },

    samples: {
      async insert(list) {
        for (const sample of list) {
          const { id, ...data } = sampleToRow(structuredClone(sample));

          await Samples.upsert({ id } as never, data as never);
        }
      },
      async list(filter) {
        const limit = Math.max(1, Math.min(1000, filter.limit));
        const target = rows(Samples).select(["summary"]);
        const exact = !(filter.route !== undefined || filter.q !== undefined);

        if (filter.status !== undefined) {
          const status = filter.status.trim().toLowerCase();

          if (/^[1-5]xx$/.test(status)) {
            const base = Number(status[0]) * 100;

            target.where("status", ">=", base).where("status", "<", base + 100);
          } else if (/^\d+$/.test(status) && String(Number(status)) === status) {
            target.where("status", "=", Number(status));
          } else {
            return [];
          }
        }

        if (filter.method !== undefined) target.where("method", "=", filter.method.toUpperCase());
        if (filter.since !== undefined) target.where("started_at", ">=", filter.since);
        if (filter.until !== undefined) target.where("started_at", "<=", filter.until);
        if (filter.instance !== undefined) target.where("instance", "=", filter.instance);

        const found = await target
          .orderBy("started_at", "desc")
          .limit(exact ? limit : SAMPLE_SCAN_LIMIT)
          .get();

        // Route and text filters are substring matches the databases do not
        // share, so they run here, with the same rules as the memory store.
        return found
          .map(rowToSampleSummary)
          .filter((summary) => sampleMatches(summary, filter))
          .slice(0, limit);
      },
      async get(id) {
        const row = await byId(Samples, id);

        return row ? rowToSample(row) : null;
      },
      async prune(before) {
        return query(Samples).where("started_at", "<", before).delete();
      },
      async clear() {
        return query(Samples).where("started_at", ">=", 0).delete();
      },
    },

    reports: {
      async write(report: DevtoolsInstanceReport) {
        const { id, ...data } = reportToRow(report);

        await Reports.upsert({ id } as never, data as never);
      },
      async list(seenSince) {
        const found = await rows(Reports)
          .where("seen_at", ">=", seenSince)
          .orderBy("seen_at", "desc")
          .get();

        return found.map(rowToReport);
      },
      async prune(seenBefore) {
        return query(Reports).where("seen_at", "<", seenBefore).delete();
      },
      async remove(instanceId) {
        return removeWhere(Reports, "id", instanceId);
      },
    },
  };
}
