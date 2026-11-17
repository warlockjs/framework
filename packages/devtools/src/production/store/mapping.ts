import type { DevtoolsAuditEntry, DevtoolsInstanceReport } from "../contracts";
import type {
  DevtoolsAccountPatch,
  DevtoolsAccountRecord,
  DevtoolsInviteRecord,
  DevtoolsPasskeyRecord,
  DevtoolsSessionPatch,
  DevtoolsSessionRecord,
  DevtoolsStatePatch,
  DevtoolsStateRecord,
  DevtoolsStoredSample,
} from "./types";

/**
 * The record <-> row mapping of the cascade store. Rows use snake_case column
 * names; times are epoch milliseconds in integer columns on every driver.
 * Pure functions, so they are tested without a database.
 */
export type Row = Record<string, unknown>;

/** A number from a column that a driver may return as a string (PostgreSQL `bigint`). */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** Like `toNumber`, keeping `null` for a missing value. */
export function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

export function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "t";
}

/** Parses JSON text; a value a driver already parsed passes through. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value === null || value === undefined ? fallback : (value as T);
}

function toArray<T>(value: unknown): T[] {
  const parsed = parseJson<unknown>(value, []);

  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const ACCOUNT_COLUMNS = {
  email: "email",
  role: "role",
  passwordHash: "password_hash",
  passwordSource: "password_source",
  mustChangePassword: "must_change_password",
  totpSecret: "totp_secret",
  totpEnabledAt: "totp_enabled_at",
  totpLastStep: "totp_last_step",
  recoveryCodes: "recovery_codes",
  passkeys: "passkeys",
  failuresResetAt: "failures_reset_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  lastLoginAt: "last_login_at",
  createdBy: "created_by",
  version: "version",
} as const satisfies Record<keyof Omit<DevtoolsAccountRecord, "id">, string>;

export function accountToRow(record: DevtoolsAccountRecord): Row {
  return { id: record.id, ...fieldsToRow(ACCOUNT_COLUMNS, record) };
}

export function accountPatchToRow(patch: DevtoolsAccountPatch): Row {
  return fieldsToRow(ACCOUNT_COLUMNS, patch);
}

export function rowToAccount(row: Row): DevtoolsAccountRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role as DevtoolsAccountRecord["role"],
    passwordHash: String(row.password_hash),
    passwordSource: row.password_source as DevtoolsAccountRecord["passwordSource"],
    mustChangePassword: toBoolean(row.must_change_password),
    totpSecret: toStringOrNull(row.totp_secret),
    totpEnabledAt: toNumberOrNull(row.totp_enabled_at),
    totpLastStep: toNumberOrNull(row.totp_last_step),
    recoveryCodes: toArray<string>(row.recovery_codes),
    passkeys: toArray<DevtoolsPasskeyRecord>(row.passkeys),
    failuresResetAt: toNumberOrNull(row.failures_reset_at),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    lastLoginAt: toNumberOrNull(row.last_login_at),
    createdBy: toStringOrNull(row.created_by),
    version: toNumber(row.version),
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SESSION_COLUMNS = {
  tokenHash: "token_hash",
  accountId: "account_id",
  stage: "stage",
  csrfSecret: "csrf_secret",
  createdAt: "created_at",
  lastSeenAt: "last_seen_at",
  expiresAt: "expires_at",
  ip: "ip",
  userAgent: "user_agent",
  pendingTotpSecret: "pending_totp_secret",
  challenge: "challenge",
  challengeExpiresAt: "challenge_expires_at",
  version: "version",
} as const satisfies Record<keyof Omit<DevtoolsSessionRecord, "id">, string>;

export function sessionToRow(record: DevtoolsSessionRecord): Row {
  return { id: record.id, ...fieldsToRow(SESSION_COLUMNS, record) };
}

export function sessionPatchToRow(patch: DevtoolsSessionPatch): Row {
  return fieldsToRow(SESSION_COLUMNS, patch);
}

export function rowToSession(row: Row): DevtoolsSessionRecord {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    accountId: String(row.account_id),
    stage: row.stage as DevtoolsSessionRecord["stage"],
    csrfSecret: String(row.csrf_secret),
    createdAt: toNumber(row.created_at),
    lastSeenAt: toNumber(row.last_seen_at),
    expiresAt: toNumber(row.expires_at),
    ip: toStringOrNull(row.ip),
    userAgent: toStringOrNull(row.user_agent),
    pendingTotpSecret: toStringOrNull(row.pending_totp_secret),
    challenge: toStringOrNull(row.challenge),
    challengeExpiresAt: toNumberOrNull(row.challenge_expires_at),
    version: toNumber(row.version),
  };
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export function inviteToRow(record: DevtoolsInviteRecord): Row {
  return {
    id: record.id,
    token_hash: record.tokenHash,
    email: record.email,
    role: record.role,
    created_by: record.createdBy,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    used_at: record.usedAt,
    account_id: record.accountId,
  };
}

export function rowToInvite(row: Row): DevtoolsInviteRecord {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    email: String(row.email),
    role: row.role as DevtoolsInviteRecord["role"],
    createdBy: toStringOrNull(row.created_by),
    createdAt: toNumber(row.created_at),
    expiresAt: toNumber(row.expires_at),
    usedAt: toNumberOrNull(row.used_at),
    accountId: toStringOrNull(row.account_id),
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function auditToRow(entry: DevtoolsAuditEntry): Row {
  return {
    id: entry.id,
    type: entry.type,
    occurred_at: entry.at,
    account_id: entry.accountId,
    email: entry.email,
    ip: entry.ip,
    user_agent: entry.userAgent,
    detail: entry.detail,
    ref: entry.ref,
  };
}

export function rowToAudit(row: Row): DevtoolsAuditEntry {
  return {
    id: String(row.id),
    at: toNumber(row.occurred_at),
    type: row.type as DevtoolsAuditEntry["type"],
    accountId: toStringOrNull(row.account_id),
    email: toStringOrNull(row.email),
    ip: toStringOrNull(row.ip),
    userAgent: toStringOrNull(row.user_agent),
    detail: parseJson<DevtoolsAuditEntry["detail"]>(row.detail, {}),
    ref: String(row.ref),
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STATE_COLUMNS = {
  disabled: "disabled",
  disabledPathHash: "disabled_path_hash",
  disabledAt: "disabled_at",
  disabledBy: "disabled_by",
  lockedUntil: "locked_until",
  failuresResetAt: "failures_reset_at",
  updatedAt: "updated_at",
  version: "version",
} as const satisfies Record<keyof DevtoolsStateRecord, string>;

export function stateToRow(record: DevtoolsStateRecord): Row {
  return fieldsToRow(STATE_COLUMNS, record);
}

export function statePatchToRow(patch: DevtoolsStatePatch): Row {
  return fieldsToRow(STATE_COLUMNS, patch);
}

export function rowToState(row: Row): DevtoolsStateRecord {
  return {
    disabled: toBoolean(row.disabled),
    disabledPathHash: toStringOrNull(row.disabled_path_hash),
    disabledAt: toNumberOrNull(row.disabled_at),
    disabledBy: toStringOrNull(row.disabled_by),
    lockedUntil: toNumberOrNull(row.locked_until),
    failuresResetAt: toNumberOrNull(row.failures_reset_at),
    updatedAt: toNumber(row.updated_at),
    version: toNumber(row.version),
  };
}

// ---------------------------------------------------------------------------
// Samples and reports
// ---------------------------------------------------------------------------

/**
 * `detail` is JSON text, not a JSON column: a sample holds keys from request
 * data (headers, query names) and MongoDB rejects or misreads field names
 * that start with `$` or contain dots.
 */
export function sampleToRow(sample: DevtoolsStoredSample): Row {
  return {
    id: sample.id,
    instance: sample.instance,
    started_at: sample.startedAt,
    status: sample.summary.status ?? null,
    method: sample.summary.method.toUpperCase(),
    path: sample.summary.path,
    summary: sample.summary,
    detail: sample.detail === null ? null : JSON.stringify(sample.detail),
  };
}

export function rowToSampleSummary(row: Row): DevtoolsStoredSample["summary"] {
  return parseJson<DevtoolsStoredSample["summary"]>(row.summary, {} as never);
}

export function rowToSample(row: Row): DevtoolsStoredSample {
  const detail = row.detail;

  return {
    id: String(row.id),
    instance: String(row.instance),
    startedAt: toNumber(row.started_at),
    summary: parseJson<DevtoolsStoredSample["summary"]>(row.summary, {} as never),
    detail:
      detail === null || detail === undefined
        ? null
        : parseJson<DevtoolsStoredSample["detail"]>(detail, null),
  };
}

/** `data` is JSON text for the same reason as a sample's `detail`. */
export function reportToRow(report: DevtoolsInstanceReport): Row {
  return {
    id: report.instance.id,
    seen_at: report.at,
    data: JSON.stringify(report),
  };
}

export function rowToReport(row: Row): DevtoolsInstanceReport {
  return parseJson<DevtoolsInstanceReport>(row.data, {} as never);
}

// ---------------------------------------------------------------------------

/** Maps the defined fields of `source` to their columns. */
function fieldsToRow(columns: Record<string, string>, source: object): Row {
  const row: Row = {};
  const values = source as Record<string, unknown>;

  for (const [field, column] of Object.entries(columns)) {
    const value = values[field];

    if (value !== undefined) row[column] = value;
  }

  return row;
}
