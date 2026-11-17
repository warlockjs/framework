import type {
  DevtoolsAuditEntry,
  DevtoolsAuditType,
  DevtoolsInstanceReport,
  DevtoolsPasswordSource,
  DevtoolsRole,
  DevtoolsSampleDetail,
  DevtoolsSampleSummary,
  DevtoolsSessionStage,
} from "../contracts";

/**
 * Where the production monitor keeps what must be shared by every process and
 * survive a restart: accounts, sessions, invites, the audit log, the
 * dashboard state (disable flag, global lock), request samples and instance
 * reports.
 *
 * Two implementations: `createCascadeStore()` (the app's database through
 * `@warlock.js/cascade`, MongoDB or SQL) for production, and
 * `createMemoryStore()` for specs. Every method is safe to call from several
 * processes at once: writes that must not race take the record's `version`
 * and succeed only when it still matches (compare-and-set).
 *
 * Emails are passed in lower case by the callers. Times are epoch ms.
 */
export interface DevtoolsStore {
  readonly accounts: DevtoolsAccountStore;
  readonly sessions: DevtoolsSessionStore;
  readonly invites: DevtoolsInviteStore;
  readonly audit: DevtoolsAuditStore;
  readonly state: DevtoolsStateStore;
  readonly samples: DevtoolsSampleStore;
  readonly reports: DevtoolsReportStore;
  /**
   * Checks that every table or collection exists. Throws
   * `DevtoolsProductionConfigError("DT008")` when one is missing.
   */
  verify(): Promise<void>;
}

/** A passkey registered as a second factor. */
export type DevtoolsPasskeyRecord = {
  /** The credential id, base64url. */
  id: string;
  /** The COSE public key, base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
  /** A label the owner sees, e.g. "Passkey added 2026-11-17". */
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

/** One monitor account (table/collection `devtools_accounts`). */
export type DevtoolsAccountRecord = {
  id: string;
  /** Lower case, unique. */
  email: string;
  role: DevtoolsRole;
  /** Core's `hashPassword` output. */
  passwordHash: string;
  passwordSource: DevtoolsPasswordSource;
  mustChangePassword: boolean;
  /** The TOTP secret encrypted with core's `encrypt()`; `null` when no authenticator app is enrolled. */
  totpSecret: string | null;
  totpEnabledAt: number | null;
  /** The last accepted TOTP time step; a code from this step or an earlier one is refused (no replay). */
  totpLastStep: number | null;
  /** SHA-256 hex digests of the unused recovery codes. */
  recoveryCodes: string[];
  passkeys: DevtoolsPasskeyRecord[];
  /** Failures before this time do not count toward the account limit (set at sign-in and by the CLI). */
  failuresResetAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  /** The admin account that invited this one; `null` for the env admin and the CLI. */
  createdBy: string | null;
  /** Incremented by every update; the compare-and-set token. */
  version: number;
};

/** The fields a new account is created with. */
export type NewDevtoolsAccount = Omit<
  DevtoolsAccountRecord,
  "id" | "createdAt" | "updatedAt" | "version"
>;

/** The fields an update may change. */
export type DevtoolsAccountPatch = Partial<
  Omit<DevtoolsAccountRecord, "id" | "createdAt" | "updatedAt" | "version">
>;

export interface DevtoolsAccountStore {
  findByEmail(email: string): Promise<DevtoolsAccountRecord | null>;
  findById(id: string): Promise<DevtoolsAccountRecord | null>;
  /** Oldest first. */
  list(): Promise<DevtoolsAccountRecord[]>;
  countAdmins(): Promise<number>;
  /** Throws `DevtoolsStoreConflictError("email")` when the email is taken. */
  create(input: NewDevtoolsAccount): Promise<DevtoolsAccountRecord>;
  /**
   * Applies `patch` when the stored version equals `expectedVersion`, bumping
   * the version and `updatedAt`. Returns the updated record, or `null` when
   * the account is gone or another write won.
   */
  update(
    id: string,
    expectedVersion: number,
    patch: DevtoolsAccountPatch,
  ): Promise<DevtoolsAccountRecord | null>;
  remove(id: string): Promise<boolean>;
}

/** One browser session (table/collection `devtools_sessions`). */
export type DevtoolsSessionRecord = {
  id: string;
  /** SHA-256 hex of the cookie token; the token itself is never stored. */
  tokenHash: string;
  accountId: string;
  stage: Exclude<DevtoolsSessionStage, "signed-out">;
  /**
   * A random per-session value. The CSRF token is HMAC-SHA256(app key,
   * `<session id>:<csrfSecret>`), so every tab of the session gets the same
   * token and a database leak alone does not reveal it.
   */
  csrfSecret: string;
  createdAt: number;
  lastSeenAt: number;
  /** Absolute end: `createdAt + maxHours` (or `+ pendingMinutes` before `active`). */
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
  /** A TOTP secret being enrolled (encrypted), until the first code confirms it. */
  pendingTotpSecret: string | null;
  /** A WebAuthn challenge waiting for its answer, single use. */
  challenge: string | null;
  challengeExpiresAt: number | null;
  version: number;
};

export type NewDevtoolsSession = Omit<DevtoolsSessionRecord, "id" | "version">;

export type DevtoolsSessionPatch = Partial<
  Omit<DevtoolsSessionRecord, "id" | "accountId" | "version">
>;

export interface DevtoolsSessionStore {
  create(input: NewDevtoolsSession): Promise<DevtoolsSessionRecord>;
  findByTokenHash(tokenHash: string): Promise<DevtoolsSessionRecord | null>;
  /** Newest first. */
  listForAccount(accountId: string): Promise<DevtoolsSessionRecord[]>;
  /** Compare-and-set like `accounts.update`. */
  update(
    id: string,
    expectedVersion: number,
    patch: DevtoolsSessionPatch,
  ): Promise<DevtoolsSessionRecord | null>;
  remove(id: string): Promise<boolean>;
  /** Removes every session of the account except `exceptId`; returns how many. */
  removeForAccount(accountId: string, exceptId?: string): Promise<number>;
  /** Removes sessions whose `expiresAt` is before `now`; returns how many. */
  removeExpired(now: number): Promise<number>;
}

/** One invite (table/collection `devtools_invites`). */
export type DevtoolsInviteRecord = {
  id: string;
  /** SHA-256 hex of the invite token. */
  tokenHash: string;
  email: string;
  role: DevtoolsRole;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  accountId: string | null;
};

export type NewDevtoolsInvite = Omit<DevtoolsInviteRecord, "id" | "usedAt" | "accountId">;

export interface DevtoolsInviteStore {
  create(input: NewDevtoolsInvite): Promise<DevtoolsInviteRecord>;
  findByTokenHash(tokenHash: string): Promise<DevtoolsInviteRecord | null>;
  /** Newest first; used invites only when `includeUsed`. */
  list(options?: { includeUsed?: boolean }): Promise<DevtoolsInviteRecord[]>;
  /**
   * Marks the invite used when it is unused and `at` is before `expiresAt`.
   * Returns `false` when another request used it first or it expired.
   */
  markUsed(id: string, at: number, accountId: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** Removes unused invites that expired before `now`. */
  removeExpired(now: number): Promise<number>;
}

/** Filter of `audit.count` (the rate limits). */
export type DevtoolsAuditCountFilter = {
  types: readonly DevtoolsAuditType[];
  /** Entries at or after this time. */
  since: number;
  accountId?: string;
  ip?: string;
};

/** Filter of `audit.list` (the Audit screen). */
export type DevtoolsAuditListFilter = {
  types?: readonly DevtoolsAuditType[];
  accountId?: string;
  /** Entries strictly before this time (paging). */
  before?: number;
  /** 1–500. */
  limit: number;
};

export interface DevtoolsAuditStore {
  /** Assigns the id; `ref` and `at` are the caller's. */
  append(entry: Omit<DevtoolsAuditEntry, "id">): Promise<DevtoolsAuditEntry>;
  /** Newest first. */
  list(filter: DevtoolsAuditListFilter): Promise<DevtoolsAuditEntry[]>;
  count(filter: DevtoolsAuditCountFilter): Promise<number>;
  /** Removes entries before `before`; returns how many. */
  prune(before: number): Promise<number>;
}

/** The single dashboard state row (table/collection `devtools_state`, id `"state"`). */
export type DevtoolsStateRecord = {
  /** Set by "Disable dashboard"; applies only while `disabledPathHash` matches the current path. */
  disabled: boolean;
  /** SHA-256 hex of the path that was disabled, so a new `DEVTOOLS_PATH` starts enabled. */
  disabledPathHash: string | null;
  disabledAt: number | null;
  disabledBy: string | null;
  /** The whole dashboard answers 404 until this time (global failure limit). */
  lockedUntil: number | null;
  /** Failures before this time count toward no limit (set by `warlock devtools:enable`). */
  failuresResetAt: number | null;
  updatedAt: number;
  version: number;
};

export type DevtoolsStatePatch = Partial<Omit<DevtoolsStateRecord, "updatedAt" | "version">>;

export interface DevtoolsStateStore {
  /** The state row; a default (enabled, unlocked, version 0) when none was written yet. */
  read(): Promise<DevtoolsStateRecord>;
  /** Compare-and-set on `version`; creates the row on the first write. */
  update(expectedVersion: number, patch: DevtoolsStatePatch): Promise<DevtoolsStateRecord | null>;
}

/** A sampled request as stored (table/collection `devtools_samples`). Values are already removed. */
export type DevtoolsStoredSample = {
  /** The request id. */
  id: string;
  instance: string;
  startedAt: number;
  summary: DevtoolsSampleSummary;
  /** `null` for a partial (unsampled slow or failed) request. */
  detail: DevtoolsSampleDetail | null;
};

/** Filter of `samples.list`, the same keys as the development request filter. */
export type DevtoolsSampleFilter = {
  /** `"404"`, `"4xx"`, `"5xx"` or an exact status. */
  status?: string;
  /** Substring of the route pattern or path. */
  route?: string;
  method?: string;
  since?: number;
  until?: number;
  /** Substring of the path. */
  q?: string;
  instance?: string;
  /** 1–1000. */
  limit: number;
};

export interface DevtoolsSampleStore {
  /** Inserts; a sample whose id exists is replaced. */
  insert(samples: readonly DevtoolsStoredSample[]): Promise<void>;
  /** Newest first. */
  list(filter: DevtoolsSampleFilter): Promise<DevtoolsSampleSummary[]>;
  get(id: string): Promise<DevtoolsStoredSample | null>;
  /** Removes samples that started before `before`. */
  prune(before: number): Promise<number>;
  /** Removes every sample; returns how many. */
  clear(): Promise<number>;
}

export interface DevtoolsReportStore {
  /** Upserts the instance's row (key: `report.instance.id`). */
  write(report: DevtoolsInstanceReport): Promise<void>;
  /** Reports written at or after `seenSince`, newest first. */
  list(seenSince: number): Promise<DevtoolsInstanceReport[]>;
  /** Removes reports last written before `seenBefore`. */
  prune(seenBefore: number): Promise<number>;
  remove(instanceId: string): Promise<boolean>;
}
