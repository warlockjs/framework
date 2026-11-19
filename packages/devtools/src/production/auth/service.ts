import { randomBytes } from "node:crypto";
import type {
  DevtoolsAccountView,
  DevtoolsAuditType,
  DevtoolsErrorCode,
  DevtoolsInviteView,
  DevtoolsRole,
  DevtoolsSessionInfo,
  DevtoolsSessionStage,
  DevtoolsSessionView,
} from "../contracts";
import { readVersions } from "../../app-versions";
import { DEVTOOLS_FAILURE_AUDIT_TYPES } from "../contracts";
import {
  createErrorRef,
  DevtoolsApiError,
  DevtoolsProductionConfigError,
  DevtoolsStoreConflictError,
} from "../errors";
import { rateLimitClient } from "../http/ip";
import type {
  DevtoolsAccountPatch,
  DevtoolsAccountRecord,
  DevtoolsInviteRecord,
  DevtoolsSessionPatch,
  DevtoolsSessionRecord,
} from "../store/types";
import {
  checkPasswordPolicy,
  generateRecoveryCode,
  generateToken,
  hashRecoveryCode,
  hashToken,
  isPlausibleEmail,
  normalizeEmail,
  normalizeRecoveryCode,
  safeEqual,
} from "./helpers";
import type {
  DevtoolsAuthDeps,
  DevtoolsAuthenticated,
  DevtoolsAuthService,
  DevtoolsAuthStep,
  DevtoolsRequestMeta,
} from "./types";

type Stage = Exclude<DevtoolsSessionStage, "signed-out">;
type AuditDetail = Record<string, string | number | boolean | null>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Password verifications (and hashes) a process runs at the same time. */
const MAX_IN_FLIGHT = 4;
/** `lastSeenAt` is written at most this often. */
const TOUCH_INTERVAL = MINUTE;
const INVITE_TTL = 24 * HOUR;
const CHALLENGE_TTL = 5 * MINUTE;
const TOTP_ISSUER = "Warlock monitor";
const RECOVERY_CODE_COUNT = 10;
/** A password longer than this is cut before hashing, so input size is no CPU lever. */
const MAX_PASSWORD_INPUT = 1024;
/** How long this process remembers that an IP was over its limit. */
const IP_BLOCK_CACHE_MS = 30_000;
const IP_BLOCK_CACHE_SIZE = 1000;
/** A refused try is written to the audit log at most this often per address and account. */
const BLOCKED_AUDIT_INTERVAL = MINUTE;
const BLOCKED_AUDIT_CACHE_SIZE = 1000;
/** Marks the session as having passed a passkey check a moment ago (sensitive actions). */
const STEP_UP_CHALLENGE = "stepup:ok";
/** A stored hash no password can match. */
const NO_PASSWORD_HASH = "!no-password-set";

const hasFactor = (account: DevtoolsAccountRecord): boolean =>
  account.totpSecret !== null || account.passkeys.length > 0;

function fail(code: DevtoolsErrorCode, ref?: string): never {
  throw new DevtoolsApiError(code, ref === undefined ? {} : { ref });
}

function cut(value: string | null | undefined, length: number): string | null {
  return typeof value === "string" ? value.slice(0, length) : null;
}

/** The accounts, sessions and two-factor service of the production monitor. */
export function createDevtoolsAuth(deps: DevtoolsAuthDeps): DevtoolsAuthService {
  const { store, options, crypto, passkeys, instance } = deps;
  const now = deps.now ?? Date.now;
  const limits = options.rateLimits;
  const windowMs = limits.windowMinutes * MINUTE;

  let inFlight = 0;
  let dummyHashPromise: Promise<string> | null = null;
  const blockedIps = new Map<string, { until: number; checkedAt: number }>();
  const blockedAudits = new Map<string, { at: number; ref: string }>();

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  /** Runs password work (hashing or verifying) while fewer than four are in flight. */
  async function withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (inFlight >= MAX_IN_FLIGHT) fail("auth.busy");

    inFlight++;

    try {
      return await run();
    } finally {
      inFlight--;
    }
  }

  function dummyHash(): Promise<string> {
    dummyHashPromise ??= crypto.hashPassword(`devtools-timing-${randomBytes(12).toString("hex")}`);

    return dummyHashPromise;
  }

  async function verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return (await crypto.verifyPassword(password, hash)) === true;
    } catch {
      return false;
    }
  }

  const hashPassword = (password: string): Promise<string> =>
    withSlot(() => crypto.hashPassword(password));

  const passwordInput = (value: unknown): string =>
    typeof value === "string" ? value.slice(0, MAX_PASSWORD_INPUT) : "";

  function requirePolicy(password: string, email: string): void {
    const problem = checkPasswordPolicy(password, email, options.passwords);

    if (problem === "auth.password-too-short") {
      throw new DevtoolsApiError(problem, {
        message: `Use a password of at least ${options.passwords.minLength} characters.`,
      });
    }

    if (problem !== null) fail(problem);
  }

  const csrfToken = (session: DevtoolsSessionRecord): string =>
    Buffer.from(crypto.hmac(`devtools-csrf:${session.id}:${session.csrfSecret}`)).toString(
      "base64url",
    );

  function accountView(account: DevtoolsAccountRecord): DevtoolsAccountView {
    return {
      id: account.id,
      email: account.email,
      role: account.role,
      twoFactor: {
        totp: account.totpSecret !== null,
        passkeys: account.passkeys.map((passkey) => ({
          id: passkey.id,
          name: passkey.name,
          createdAt: passkey.createdAt,
          lastUsedAt: passkey.lastUsedAt,
        })),
        recoveryCodesLeft: account.recoveryCodes.length,
      },
      mustChangePassword: account.mustChangePassword,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
    };
  }

  function inviteView(invite: DevtoolsInviteRecord): DevtoolsInviteView {
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      createdBy: invite.createdBy,
      usedAt: invite.usedAt,
    };
  }

  const twoFactorRequired = (account: DevtoolsAccountRecord): boolean =>
    options.twoFactor === "everyone" ||
    (options.twoFactor === "admins" && account.role === "admin");

  /** Where an account goes after its password is accepted. */
  function nextStage(account: DevtoolsAccountRecord): Stage {
    if (account.mustChangePassword) return "password-change";

    if (hasFactor(account)) return "mfa-verify";

    if (twoFactorRequired(account)) return "mfa-enrol";

    return "active";
  }

  function rpIdFor(meta: DevtoolsRequestMeta): string {
    if (options.passkeys.rpId) return options.passkeys.rpId;

    if (options.origin) {
      try {
        return new URL(options.origin).hostname;
      } catch {
        // Fall through to the request's host.
      }
    }

    return meta.hostname;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async function audit(
    type: DevtoolsAuditType,
    input: {
      auth?: DevtoolsAuthenticated | null;
      accountId?: string | null;
      email?: string | null;
      meta?: DevtoolsRequestMeta | null;
      detail?: AuditDetail;
    } = {},
  ): Promise<string> {
    const ref = createErrorRef();

    try {
      const email = input.email ?? input.auth?.account.email ?? null;

      await store.audit.append({
        at: now(),
        type,
        accountId: input.accountId ?? input.auth?.account.id ?? null,
        email: email === null ? null : email.trim().toLowerCase().slice(0, 254),
        ip: input.meta?.ip ?? null,
        userAgent: cut(input.meta?.userAgent, 200),
        detail: input.detail ?? {},
        ref,
      });
    } catch (error) {
      try {
        deps.warn?.(
          `devtools audit write failed (${type}, ref ${ref}): ${error instanceof Error ? error.message : "unknown error"}`,
        );
      } catch {
        // Logging must never throw.
      }
    }

    return ref;
  }

  /**
   * Writes a `login.blocked` entry, at most once a minute per address and
   * account: refused tries cost no password check against the limits, so
   * without this a caller over its limit could grow the audit log without
   * bound. A skipped write answers the reference of the last one.
   */
  async function auditBlocked(input: {
    auth?: DevtoolsAuthenticated | null;
    accountId?: string | null;
    email?: string | null;
    meta: DevtoolsRequestMeta;
    detail?: AuditDetail;
  }): Promise<string> {
    const key = `${rateLimitClient(input.meta.ip)}|${input.accountId ?? input.auth?.account.id ?? ""}`;
    const at = now();
    const last = blockedAudits.get(key);

    if (last && at - last.at < BLOCKED_AUDIT_INTERVAL) return last.ref;

    blockedAudits.delete(key);

    if (blockedAudits.size >= BLOCKED_AUDIT_CACHE_SIZE) {
      const oldest = blockedAudits.keys().next();

      if (!oldest.done) blockedAudits.delete(oldest.value);
    }

    const ref = await audit("login.blocked", input);

    blockedAudits.set(key, { at, ref });

    return ref;
  }

  // -------------------------------------------------------------------------
  // Compare-and-set helpers
  // -------------------------------------------------------------------------

  /**
   * Applies the patch `build` makes from the latest record. When another write
   * wins, the record is read again and `build` runs again, so a rule it checks
   * (a replayed TOTP step, a recovery code already used) is checked against
   * the newest data. `build` returns `null` to refuse.
   */
  async function casAccount(
    account: DevtoolsAccountRecord,
    build: (fresh: DevtoolsAccountRecord) => DevtoolsAccountPatch | null,
  ): Promise<DevtoolsAccountRecord | null> {
    let current: DevtoolsAccountRecord | null = account;

    for (let attempt = 0; attempt < 4 && current; attempt++) {
      const patch = build(current);

      if (patch === null) return null;

      const updated = await store.accounts.update(current.id, current.version, patch);

      if (updated) return updated;

      current = await store.accounts.findById(current.id);
    }

    return null;
  }

  async function casSession(
    session: DevtoolsSessionRecord,
    build: (fresh: DevtoolsSessionRecord) => DevtoolsSessionPatch | null,
  ): Promise<DevtoolsSessionRecord | null> {
    let current: DevtoolsSessionRecord | null = session;

    for (let attempt = 0; attempt < 4 && current; attempt++) {
      const patch = build(current);

      if (patch === null) return null;

      const updated = await store.sessions.update(current.id, current.version, patch);

      if (updated) return updated;

      current = await store.sessions.findByTokenHash(current.tokenHash);
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Rate limits
  // -------------------------------------------------------------------------

  /** Whether the client of `ip` (the address, or its /64 for IPv6) is over the per-IP limit. */
  async function ipOverLimit(ip: string, since: number, stateResetAt: number): Promise<boolean> {
    const client = rateLimitClient(ip);
    const cached = blockedIps.get(client);

    if (cached && now() < cached.until && cached.checkedAt >= stateResetAt) return true;

    const count = await store.audit.count({
      types: DEVTOOLS_FAILURE_AUDIT_TYPES,
      since,
      ip,
    });

    if (count < limits.ip) {
      blockedIps.delete(client);

      return false;
    }

    if (blockedIps.size >= IP_BLOCK_CACHE_SIZE) {
      const oldest = blockedIps.keys().next();

      if (!oldest.done) blockedIps.delete(oldest.value);
    }

    blockedIps.set(client, { until: now() + IP_BLOCK_CACHE_MS, checkedAt: now() });

    return true;
  }

  /** Whether a try from `ip` for `account` is refused: dashboard locked, or the IP or the account is over its limit. */
  async function isBlocked(account: DevtoolsAccountRecord | null, ip: string): Promise<boolean> {
    return (await blockedBy(account, ip)) !== null;
  }

  /**
   * Why a try is refused: `"caller"` when the dashboard is locked or the IP is
   * over its limit (nothing about the account), `"account"` when only the
   * account is, `null` when it is not refused.
   */
  async function blockedBy(
    account: DevtoolsAccountRecord | null,
    ip: string,
  ): Promise<"caller" | "account" | null> {
    const state = await store.state.read();
    const at = now();
    const stateResetAt = state.failuresResetAt ?? 0;
    const since = Math.max(at - windowMs, stateResetAt);
    const accountSince = Math.max(since, account?.failuresResetAt ?? 0);
    const locked = state.lockedUntil !== null && state.lockedUntil > at;
    // Both counts always run, so an unknown email costs the same queries.
    const overIp = await ipOverLimit(ip, since, stateResetAt);
    const accountCount = await store.audit.count({
      types: DEVTOOLS_FAILURE_AUDIT_TYPES,
      since: accountSince,
      accountId: account?.id ?? "-",
    });

    if (locked || overIp) return "caller";

    return account !== null && accountCount >= limits.account ? "account" : null;
  }

  /** Closes the whole dashboard for `lockMinutes` once failures anywhere reach the global limit. */
  async function lockWhenOverGlobalLimit(meta: DevtoolsRequestMeta): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await store.state.read();
      const at = now();

      if (state.lockedUntil !== null && state.lockedUntil > at) return;

      const since = Math.max(at - windowMs, state.failuresResetAt ?? 0);
      const count = await store.audit.count({ types: DEVTOOLS_FAILURE_AUDIT_TYPES, since });

      if (count < limits.global) return;

      const updated = await store.state.update(state.version, {
        lockedUntil: at + limits.lockMinutes * MINUTE,
      });

      if (updated) {
        await audit("dashboard.locked", {
          meta,
          detail: { minutes: limits.lockMinutes, failures: count },
        });

        return;
      }
    }
  }

  async function failLogin(
    type: "login.failed" | "login.blocked",
    code: DevtoolsErrorCode,
    input: {
      email: string | null;
      accountId?: string | null;
      meta: DevtoolsRequestMeta;
      detail?: AuditDetail;
    },
  ): Promise<never> {
    const ref = type === "login.blocked" ? await auditBlocked(input) : await audit(type, input);

    if (type === "login.failed") await lockWhenOverGlobalLimit(input.meta);

    return fail(code, ref);
  }

  /** Records a failed second factor (it counts toward the limits) and refuses. */
  async function failSecondFactor(
    auth: DevtoolsAuthenticated,
    meta: DevtoolsRequestMeta,
    method: string,
    code: DevtoolsErrorCode = "auth.invalid-code",
  ): Promise<never> {
    const ref = await audit("mfa.failed", { auth, meta, detail: { method } });

    await lockWhenOverGlobalLimit(meta);

    return fail(code, ref);
  }

  /** Refuses a second-factor try while the IP, the account or the dashboard is over its limit. */
  async function guardSecondFactor(
    auth: DevtoolsAuthenticated,
    meta: DevtoolsRequestMeta,
    code: DevtoolsErrorCode = "auth.invalid-code",
  ): Promise<void> {
    if (await isBlocked(auth.account, meta.ip)) {
      const ref = await auditBlocked({ auth, meta, detail: { step: "second-factor" } });

      fail(code, ref);
    }
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async function createSession(
    account: DevtoolsAccountRecord,
    stage: Stage,
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    const token = generateToken();
    const at = now();
    const lifetime =
      stage === "active"
        ? options.session.maxHours * HOUR
        : options.session.pendingMinutes * MINUTE;
    const session = await store.sessions.create({
      tokenHash: hashToken(token),
      accountId: account.id,
      stage,
      csrfSecret: randomBytes(32).toString("base64url"),
      createdAt: at,
      lastSeenAt: at,
      expiresAt: at + lifetime,
      ip: meta.ip,
      userAgent: cut(meta.userAgent, 200),
      pendingTotpSecret: null,
      challenge: null,
      challengeExpiresAt: null,
    });

    return { stage, token, csrf: csrfToken(session), session };
  }

  /**
   * Moves a session to `stage`. Reaching `active` mints a new token (the old
   * session is removed); any other stage changes the session in place.
   */
  async function moveTo(
    auth: DevtoolsAuthenticated,
    account: DevtoolsAccountRecord,
    stage: Stage,
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    if (stage === "active") {
      // Fully signed in: earlier failures of this account stop counting. Never at the password step, or each new
      // sign-in with a known password would open a fresh round of second-factor guesses.
      const reset = await casAccount(account, () => ({ failuresResetAt: now() }));
      const step = await createSession(reset ?? account, "active", meta);

      await store.sessions.remove(auth.session.id);

      return step;
    }

    const session = await casSession(auth.session, () => ({
      stage,
      pendingTotpSecret: null,
      challenge: null,
      challengeExpiresAt: null,
      expiresAt: now() + options.session.pendingMinutes * MINUTE,
    }));

    if (!session) fail("server.error");

    return { stage, token: null, csrf: csrfToken(session), session };
  }

  function requireStage(auth: DevtoolsAuthenticated, ...stages: Stage[]): void {
    if (!stages.includes(auth.stage)) fail("input.invalid");
  }

  function requireAdmin(auth: DevtoolsAuthenticated): void {
    if (auth.stage !== "active" || auth.account.role !== "admin") fail("role.forbidden");
  }

  // -------------------------------------------------------------------------
  // Recovery codes
  // -------------------------------------------------------------------------

  function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

    return { codes, hashes: codes.map(hashRecoveryCode) };
  }

  /** The step a TOTP code matches for this account, or `null` (also `null` when the step was already used). */
  function totpStepFor(account: DevtoolsAccountRecord, code: string): number | null {
    if (account.totpSecret === null) return null;

    let secret: string;

    try {
      secret = crypto.decrypt(account.totpSecret);
    } catch {
      return null;
    }

    return crypto.verifyTotp(secret, String(code ?? ""), now());
  }

  /** Records `step` as used; refuses when the same or a later step was already accepted. */
  async function consumeTotpStep(
    account: DevtoolsAccountRecord,
    step: number,
  ): Promise<DevtoolsAccountRecord | null> {
    return casAccount(account, (fresh) =>
      fresh.totpLastStep !== null && step <= fresh.totpLastStep ? null : { totpLastStep: step },
    );
  }

  // -------------------------------------------------------------------------
  // First admin
  // -------------------------------------------------------------------------

  async function ensureFirstAdmin(): Promise<void> {
    const admin = options.admin;
    const email = normalizeEmail(admin.email);
    const existing = email ? await store.accounts.findByEmail(email) : null;

    if (existing && existing.role === "admin") {
      if (existing.passwordSource === "env" && admin.password !== null) {
        const same = await withSlot(() =>
          verifyPassword(admin.password as string, existing.passwordHash),
        );

        if (!same) {
          if (checkPasswordPolicy(admin.password, email, options.passwords) !== null) {
            throw new DevtoolsProductionConfigError("DT004");
          }

          const hash = await hashPassword(admin.password);
          const updated = await casAccount(existing, (fresh) =>
            fresh.passwordSource === "env"
              ? { passwordHash: hash, mustChangePassword: true }
              : null,
          );

          if (updated) {
            await store.sessions.removeForAccount(updated.id);
            await audit("admin.reset", { accountId: updated.id, email, detail: { source: "env" } });
          }
        }
      }

      return;
    }

    if ((await store.accounts.countAdmins()) > 0) return;

    if (existing || !email || (admin.password === null && admin.setupToken === null)) {
      throw new DevtoolsProductionConfigError("DT003");
    }

    let record: Parameters<typeof store.accounts.create>[0];

    if (admin.password !== null) {
      if (checkPasswordPolicy(admin.password, email, options.passwords) !== null) {
        throw new DevtoolsProductionConfigError("DT004");
      }

      record = {
        email,
        role: "admin",
        passwordHash: await hashPassword(admin.password),
        passwordSource: "env",
        mustChangePassword: true,
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        recoveryCodes: [],
        passkeys: [],
        failuresResetAt: null,
        lastLoginAt: null,
        createdBy: null,
      };
    } else {
      record = {
        email,
        role: "admin",
        passwordHash: NO_PASSWORD_HASH,
        passwordSource: "setup",
        mustChangePassword: false,
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        recoveryCodes: [],
        passkeys: [],
        failuresResetAt: null,
        lastLoginAt: null,
        createdBy: null,
      };
    }

    try {
      const created = await store.accounts.create(record);

      await audit("admin.seeded", {
        accountId: created.id,
        email,
        detail: { source: record.passwordSource },
      });
    } catch (error) {
      // Another instance seeded the same admin at the same time.
      if (!(error instanceof DevtoolsStoreConflictError)) throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------------

  async function login(
    input: { email: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    const email = normalizeEmail(input?.email);
    const password = passwordInput(input?.password);
    const account = email ? await store.accounts.findByEmail(email) : null;
    const blockedReason = await blockedBy(account, meta.ip);
    const blocked = blockedReason !== null;
    const verifiable =
      !blocked && account !== null && !account.passwordHash.startsWith("!") && password !== "";
    // Unknown email, blocked account or unusable hash: verify against a dummy
    // hash so the answer takes as long as a real check. A caller that is over
    // its own limit (or a locked dashboard) learns nothing about the account
    // from the timing, so it costs no password work at all: a blocked address
    // is no lever on the app's CPU and cannot hold the verification slots.
    const hash = verifiable && account ? account.passwordHash : await dummyHash();
    const matches =
      blockedReason === "caller" ? false : await withSlot(() => verifyPassword(password, hash));

    if (blocked) {
      return failLogin("login.blocked", "auth.invalid-credentials", {
        email: email || null,
        accountId: account?.id ?? null,
        meta,
      });
    }

    if (!verifiable || !matches || account === null) {
      return failLogin("login.failed", "auth.invalid-credentials", {
        email: email || null,
        accountId: account?.id ?? null,
        meta,
      });
    }

    const at = now();
    // The failures count resets only when the password alone completes the sign-in (see `moveTo`).
    const updated = await casAccount(account, (fresh) =>
      nextStage(fresh) === "active"
        ? { failuresResetAt: at, lastLoginAt: at }
        : { lastLoginAt: at },
    );

    if (!updated) return failLogin("login.failed", "auth.invalid-credentials", { email, meta });

    await audit("login.succeeded", { accountId: updated.id, email, meta });

    return createSession(updated, nextStage(updated), meta);
  }

  async function setup(
    input: { token: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    const configured = options.admin.setupToken;
    const adminEmail = normalizeEmail(options.admin.email);
    const account = adminEmail ? await store.accounts.findByEmail(adminEmail) : null;
    const blocked = await isBlocked(null, meta.ip);
    const tokenMatches = safeEqual(
      hashToken(typeof input?.token === "string" ? input.token : ""),
      hashToken(configured ?? ""),
    );
    const usable =
      configured !== null && tokenMatches && account !== null && account.passwordSource === "setup";

    if (blocked) {
      return failLogin("login.blocked", "auth.invalid-setup-token", {
        email: adminEmail || null,
        meta,
        detail: { via: "setup" },
      });
    }

    if (!usable || account === null) {
      return failLogin("login.failed", "auth.invalid-setup-token", {
        email: adminEmail || null,
        meta,
        detail: { via: "setup" },
      });
    }

    const password = passwordInput(input.password);

    requirePolicy(password, account.email);

    const passwordHash = await hashPassword(password);
    const at = now();
    const updated = await casAccount(account, (fresh) =>
      fresh.passwordSource === "setup"
        ? {
            passwordHash,
            passwordSource: "user",
            mustChangePassword: false,
            failuresResetAt: at,
            lastLoginAt: at,
          }
        : null,
    );

    // Another request completed the setup first: the token is spent.
    if (!updated) fail("auth.invalid-setup-token");

    await audit("setup.completed", { accountId: updated.id, email: updated.email, meta });

    return createSession(updated, nextStage(updated), meta);
  }

  async function findOpenInvite(token: string): Promise<DevtoolsInviteRecord> {
    if (typeof token !== "string" || token === "" || token.length > 200) fail("invite.invalid");

    const invite = await store.invites.findByTokenHash(hashToken(token));

    if (!invite || invite.usedAt !== null || invite.expiresAt <= now()) fail("invite.invalid");

    return invite;
  }

  async function inspectInvite(token: string): Promise<{ email: string; role: DevtoolsRole }> {
    const invite = await findOpenInvite(token);

    return { email: invite.email, role: invite.role };
  }

  async function acceptInvite(
    input: { token: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    const invite = await findOpenInvite(input?.token);
    const password = passwordInput(input.password);

    requirePolicy(password, invite.email);

    const passwordHash = await hashPassword(password);

    // The invite is spent before the account exists; the loser of a race stops here.
    if (!(await store.invites.markUsed(invite.id, now(), "pending"))) fail("invite.invalid");

    let account: DevtoolsAccountRecord;

    try {
      account = await store.accounts.create({
        email: invite.email,
        role: invite.role,
        passwordHash,
        passwordSource: "invite",
        mustChangePassword: false,
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        recoveryCodes: [],
        passkeys: [],
        failuresResetAt: null,
        lastLoginAt: now(),
        createdBy: invite.createdBy,
      });
    } catch (error) {
      if (error instanceof DevtoolsStoreConflictError) fail("invite.email-taken");

      throw error;
    }

    await audit("invite.accepted", {
      accountId: account.id,
      email: account.email,
      meta,
      detail: { role: account.role },
    });

    return createSession(account, nextStage(account), meta);
  }

  // -------------------------------------------------------------------------
  // Sessions in use
  // -------------------------------------------------------------------------

  async function authenticate(token: string | undefined): Promise<DevtoolsAuthenticated | null> {
    if (typeof token !== "string" || token === "" || token.length > 200) return null;

    const session = await store.sessions.findByTokenHash(hashToken(token));

    if (!session) return null;

    const at = now();

    if (at >= session.expiresAt || at - session.lastSeenAt > options.session.idleMinutes * MINUTE) {
      await store.sessions.remove(session.id);

      return null;
    }

    const account = await store.accounts.findById(session.accountId);

    if (!account) {
      await store.sessions.remove(session.id);

      return null;
    }

    let current = session;

    if (at - session.lastSeenAt >= TOUCH_INTERVAL) {
      // A lost race only means another request touched the session first.
      const touched = await store.sessions.update(session.id, session.version, { lastSeenAt: at });

      if (touched) current = touched;
    }

    return { session: current, account, stage: current.stage };
  }

  function verifyCsrf(auth: DevtoolsAuthenticated, header: string | undefined): boolean {
    if (typeof header !== "string" || header === "") return false;

    return safeEqual(header, csrfToken(auth.session));
  }

  function sessionView(auth: DevtoolsAuthenticated | null): DevtoolsSessionView {
    if (!auth) {
      return {
        mode: "production",
        stage: "signed-out",
        account: null,
        role: null,
        csrf: null,
        expiresAt: null,
        instance: null,
        methods: null,
        share: null,
        warlockVersion: null,
        app: null,
      };
    }

    return {
      mode: "production",
      stage: auth.stage,
      account: accountView(auth.account),
      role: auth.account.role,
      csrf: csrfToken(auth.session),
      expiresAt: auth.session.expiresAt,
      instance,
      methods: { totp: true, passkeys: passkeys !== null },
      share: { enabled: options.share.enabled },
      ...(auth.stage === "active" ? readVersions() : { warlockVersion: null, app: null }),
    };
  }

  async function logout(auth: DevtoolsAuthenticated, meta: DevtoolsRequestMeta): Promise<void> {
    await store.sessions.remove(auth.session.id);
    await audit("logout", { auth, meta });
  }

  async function listSessions(auth: DevtoolsAuthenticated): Promise<DevtoolsSessionInfo[]> {
    const at = now();
    const sessions = await store.sessions.listForAccount(auth.account.id);

    return sessions
      .filter((session) => session.expiresAt > at)
      .map((session) => ({
        id: session.id,
        current: session.id === auth.session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        ip: session.ip,
        userAgent: session.userAgent,
      }));
  }

  async function revokeSession(
    auth: DevtoolsAuthenticated,
    sessionId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    // Only the caller's own sessions can be found here.
    const own = (await store.sessions.listForAccount(auth.account.id)).find(
      (session) => session.id === sessionId,
    );

    if (!own) fail("account.not-found");

    await store.sessions.remove(own.id);
    await audit("session.revoked", { auth, meta, detail: { current: own.id === auth.session.id } });
  }

  // -------------------------------------------------------------------------
  // Proving the owner again
  // -------------------------------------------------------------------------

  /**
   * Checks the current password of an active session. A wrong one counts
   * toward the sign-in limits like a failed sign-in.
   */
  async function requireCurrentPassword(
    auth: DevtoolsAuthenticated,
    given: string | undefined,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    const current = passwordInput(given);
    const stored = auth.account.passwordHash;
    const verifiable = !stored.startsWith("!") && current !== "";

    if (await isBlocked(auth.account, meta.ip)) {
      await verifyPassword(current, await dummyHash());

      const ref = await auditBlocked({ auth, meta, detail: { step: "password" } });

      fail("auth.wrong-current-password", ref);
    }

    const matches = await withSlot(async () =>
      verifyPassword(current, verifiable ? stored : await dummyHash()),
    );

    if (!verifiable || !matches) {
      const ref = await audit("login.failed", { auth, meta, detail: { step: "password" } });

      await lockWhenOverGlobalLimit(meta);

      fail("auth.wrong-current-password", ref);
    }
  }

  /**
   * Spends the session's step-up (a passkey check passed in this session in
   * the last five minutes). Compare-and-set, so two requests racing on one
   * step-up cannot both use it. Returns whether it was there to spend.
   */
  async function consumeStepUp(session: DevtoolsSessionRecord): Promise<boolean> {
    const spent = await casSession(session, (fresh) =>
      fresh.challenge === STEP_UP_CHALLENGE &&
      fresh.challengeExpiresAt !== null &&
      fresh.challengeExpiresAt > now()
        ? { challenge: null, challengeExpiresAt: null }
        : null,
    );

    return spent !== null;
  }

  /**
   * Before an active session adds or removes a second factor: the current
   * password, or, when none is given, a fresh step-up, so a stolen session
   * cookie alone cannot change how the account signs in. Not asked while
   * enrolling the first factor at sign-in, which follows the password.
   */
  async function requireOwner(
    auth: DevtoolsAuthenticated,
    current: string | undefined,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    if (auth.stage !== "active") return;

    if ((current === undefined || current === "") && (await consumeStepUp(auth.session))) return;

    await requireCurrentPassword(auth, current, meta);
  }

  // -------------------------------------------------------------------------
  // Password change
  // -------------------------------------------------------------------------

  async function changePassword(
    auth: DevtoolsAuthenticated,
    input: { current?: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    requireStage(auth, "password-change", "active");

    const password = passwordInput(input?.password);

    if (auth.stage === "active") await requireCurrentPassword(auth, input?.current, meta);

    requirePolicy(password, auth.account.email);

    if (await withSlot(() => verifyPassword(password, auth.account.passwordHash))) {
      fail("auth.password-unchanged");
    }

    const passwordHash = await hashPassword(password);
    const updated = await casAccount(auth.account, () => ({
      passwordHash,
      passwordSource: "user",
      mustChangePassword: false,
    }));

    if (!updated) fail("server.error");

    await audit("password.changed", { auth, meta });
    // Every other session of the account ends with the old password.
    await store.sessions.removeForAccount(updated.id, auth.session.id);

    if (auth.stage === "active") {
      return { stage: "active", token: null, csrf: csrfToken(auth.session), session: auth.session };
    }

    return moveTo(auth, updated, nextStage(updated), meta);
  }

  // -------------------------------------------------------------------------
  // TOTP
  // -------------------------------------------------------------------------

  async function startTotp(auth: DevtoolsAuthenticated, _meta: DevtoolsRequestMeta) {
    requireStage(auth, "mfa-enrol", "active");

    // Replacing an app needs it removed first, so a hijacked session cannot swap it silently.
    if (auth.account.totpSecret !== null) fail("input.invalid");

    const secret = crypto.generateTotpSecret();
    const saved = await casSession(auth.session, () => ({
      pendingTotpSecret: crypto.encrypt(secret),
    }));

    if (!saved) fail("server.error");

    return {
      secret,
      uri: crypto.totpUri({ secret, account: auth.account.email, issuer: TOTP_ISSUER }),
      issuer: TOTP_ISSUER,
      account: auth.account.email,
    };
  }

  async function confirmTotp(
    auth: DevtoolsAuthenticated,
    code: string,
    meta: DevtoolsRequestMeta,
    current?: string,
  ): Promise<{ step: DevtoolsAuthStep; recoveryCodes: string[] | null }> {
    requireStage(auth, "mfa-enrol", "active");

    const pending = auth.session.pendingTotpSecret;

    if (pending === null) fail("input.invalid");

    await requireOwner(auth, current, meta);
    await guardSecondFactor(auth, meta);

    let secret: string;

    try {
      secret = crypto.decrypt(pending);
    } catch {
      return failSecondFactor(auth, meta, "totp");
    }

    const step = crypto.verifyTotp(secret, String(code ?? ""), now());

    if (step === null) return failSecondFactor(auth, meta, "totp");

    const fresh = newRecoveryCodes();
    let issued = null as string[] | null;
    const updated = await casAccount(auth.account, (account) => {
      if (account.totpSecret !== null) return null;

      issued = account.recoveryCodes.length === 0 ? fresh.codes : null;

      return {
        totpSecret: pending,
        totpEnabledAt: now(),
        totpLastStep: step,
        ...(issued ? { recoveryCodes: fresh.hashes } : {}),
      };
    });

    if (!updated) fail("input.invalid");

    await audit("mfa.enrolled", { auth, meta, detail: { method: "totp" } });

    if (auth.stage === "mfa-enrol") {
      return { step: await moveTo(auth, updated, "active", meta), recoveryCodes: issued };
    }

    const session = await casSession(auth.session, () => ({ pendingTotpSecret: null }));

    return {
      step: {
        stage: "active",
        token: null,
        csrf: csrfToken(auth.session),
        session: session ?? auth.session,
      },
      recoveryCodes: issued,
    };
  }

  async function removeTotp(
    auth: DevtoolsAuthenticated,
    meta: DevtoolsRequestMeta,
    current?: string,
  ): Promise<void> {
    requireStage(auth, "active");

    if (auth.account.totpSecret === null) return;

    if (twoFactorRequired(auth.account) && auth.account.passkeys.length === 0) {
      fail("account.last-factor");
    }

    await requireOwner(auth, current, meta);

    const updated = await casAccount(auth.account, (account) => ({
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      ...(account.passkeys.length === 0 ? { recoveryCodes: [] } : {}),
    }));

    if (!updated) fail("server.error");

    await audit("mfa.removed", { auth, meta, detail: { method: "totp" } });
  }

  async function verifySecondFactor(
    auth: DevtoolsAuthenticated,
    input: { code?: string; recoveryCode?: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep> {
    requireStage(auth, "mfa-verify");

    const hasCode = typeof input?.code === "string" && input.code !== "";
    const hasRecovery = typeof input?.recoveryCode === "string" && input.recoveryCode !== "";

    if (!hasCode && !hasRecovery) fail("input.invalid");

    await guardSecondFactor(auth, meta);

    if (hasCode) {
      const step = totpStepFor(auth.account, input.code as string);
      const consumed = step === null ? null : await consumeTotpStep(auth.account, step);

      if (!consumed) return failSecondFactor(auth, meta, "totp");

      await audit("mfa.succeeded", { auth, meta, detail: { method: "totp" } });

      return moveTo(auth, consumed, "active", meta);
    }

    const given = hashRecoveryCode(input.recoveryCode as string);
    let left = 0 as number;
    // No early exit: every stored hash is compared.
    const used = await casAccount(auth.account, (account) => {
      let found = -1;

      account.recoveryCodes.forEach((stored, index) => {
        if (
          safeEqual(stored, given) &&
          normalizeRecoveryCode(input.recoveryCode as string).length === 10
        ) {
          found = index;
        }
      });

      if (found === -1) return null;

      const remaining = account.recoveryCodes.filter((_, index) => index !== found);

      left = remaining.length;

      return { recoveryCodes: remaining };
    });

    if (!used) return failSecondFactor(auth, meta, "recovery-code");

    await audit("recovery-code.used", { auth, meta, detail: { left } });

    return moveTo(auth, used, "active", meta);
  }

  async function regenerateRecoveryCodes(
    auth: DevtoolsAuthenticated,
    code: string,
    meta: DevtoolsRequestMeta,
  ): Promise<string[]> {
    requireStage(auth, "active");
    await guardSecondFactor(auth, meta);

    let account = auth.account;

    if (typeof code === "string" && code !== "" && account.totpSecret !== null) {
      const step = totpStepFor(account, code);
      const consumed = step === null ? null : await consumeTotpStep(account, step);

      if (!consumed) return failSecondFactor(auth, meta, "totp");

      account = consumed;
    } else if (!(await consumeStepUp(auth.session))) {
      // No step-up, or a parallel request spent it first.
      return failSecondFactor(auth, meta, "totp");
    }

    const fresh = newRecoveryCodes();
    const updated = await casAccount(account, () => ({ recoveryCodes: fresh.hashes }));

    if (!updated) fail("server.error");

    await audit("recovery-codes.regenerated", { auth, meta });

    return fresh.codes;
  }

  // -------------------------------------------------------------------------
  // Passkeys
  // -------------------------------------------------------------------------

  function requirePasskeys() {
    if (passkeys === null) fail("passkey.unavailable");

    return passkeys;
  }

  async function passkeyOptions(
    auth: DevtoolsAuthenticated,
    purpose: "register" | "login",
    meta: DevtoolsRequestMeta,
  ): Promise<unknown> {
    const adapter = requirePasskeys();

    if (purpose === "register") requireStage(auth, "mfa-enrol", "active");
    else requireStage(auth, "mfa-verify", "active");

    const rpId = rpIdFor(meta);
    let result: { options: unknown; challenge: string };

    if (purpose === "register") {
      result = await adapter.registrationOptions({
        account: auth.account,
        rpId,
        rpName: options.passkeys.rpName,
      });
    } else {
      if (auth.account.passkeys.length === 0) fail("passkey.failed");

      await guardSecondFactor(auth, meta, "passkey.failed");

      result = await adapter.authenticationOptions({ account: auth.account, rpId });
    }

    const saved = await casSession(auth.session, () => ({
      challenge: result.challenge,
      challengeExpiresAt: now() + CHALLENGE_TTL,
    }));

    if (!saved) fail("server.error");

    return result.options;
  }

  async function verifyPasskey(
    auth: DevtoolsAuthenticated,
    purpose: "register" | "login",
    response: unknown,
    meta: DevtoolsRequestMeta,
    current?: string,
  ): Promise<{ step: DevtoolsAuthStep | null; recoveryCodes: string[] | null }> {
    const adapter = requirePasskeys();

    if (purpose === "register") requireStage(auth, "mfa-enrol", "active");
    else requireStage(auth, "mfa-verify", "active");

    if (purpose === "login") await guardSecondFactor(auth, meta, "passkey.failed");
    // The registration challenge replaced any step-up, so an active session gives its password here.
    else if (auth.stage === "active") await requireCurrentPassword(auth, current, meta);

    const challenge = auth.session.challenge;
    const live =
      challenge !== null &&
      challenge !== STEP_UP_CHALLENGE &&
      auth.session.challengeExpiresAt !== null &&
      auth.session.challengeExpiresAt > now();

    // The challenge is single use: it is cleared before the answer is checked.
    const consumed = live
      ? await casSession(auth.session, (fresh) =>
          fresh.challenge === challenge ? { challenge: null, challengeExpiresAt: null } : null,
        )
      : null;

    if (!live || !consumed || challenge === null) {
      return purpose === "login"
        ? failSecondFactor(auth, meta, "passkey", "passkey.failed")
        : fail("passkey.failed");
    }

    const rpId = rpIdFor(meta);

    if (purpose === "register") {
      let credential: Awaited<ReturnType<typeof adapter.verifyRegistration>>;

      try {
        credential = await adapter.verifyRegistration({
          response,
          challenge,
          origin: meta.origin,
          rpId,
        });
      } catch {
        return fail("passkey.failed");
      }

      if (auth.account.passkeys.some((passkey) => passkey.id === credential.id)) {
        fail("passkey.failed");
      }

      const fresh = newRecoveryCodes();
      let issued = null as string[] | null;
      const label = `Passkey added ${new Date(now()).toISOString().slice(0, 10)}`;
      const updated = await casAccount(auth.account, (account) => {
        if (account.passkeys.some((passkey) => passkey.id === credential.id)) return null;

        issued = account.recoveryCodes.length === 0 ? fresh.codes : null;

        return {
          passkeys: [
            ...account.passkeys,
            {
              id: credential.id,
              publicKey: credential.publicKey,
              counter: credential.counter,
              transports: credential.transports,
              name: label,
              createdAt: now(),
              lastUsedAt: null,
            },
          ],
          ...(issued ? { recoveryCodes: fresh.hashes } : {}),
        };
      });

      if (!updated) fail("passkey.failed");

      await audit("passkey.added", { auth, meta });

      if (auth.stage === "mfa-enrol") {
        return { step: await moveTo(auth, updated, "active", meta), recoveryCodes: issued };
      }

      return { step: null, recoveryCodes: issued };
    }

    let verified: { id: string; newCounter: number };

    try {
      verified = await adapter.verifyAuthentication({
        response,
        challenge,
        origin: meta.origin,
        rpId,
        account: auth.account,
      });
    } catch {
      return failSecondFactor(auth, meta, "passkey", "passkey.failed");
    }

    const updated = await casAccount(auth.account, (account) => {
      if (!account.passkeys.some((passkey) => passkey.id === verified.id)) return null;

      return {
        passkeys: account.passkeys.map((passkey) =>
          passkey.id === verified.id
            ? { ...passkey, counter: verified.newCounter, lastUsedAt: now() }
            : passkey,
        ),
      };
    });

    if (!updated) return failSecondFactor(auth, meta, "passkey", "passkey.failed");

    await audit("mfa.succeeded", { auth, meta, detail: { method: "passkey" } });

    if (auth.stage === "mfa-verify") {
      return { step: await moveTo(auth, updated, "active", meta), recoveryCodes: null };
    }

    // An active session proved itself again: sensitive actions are open for five minutes.
    await casSession(auth.session, () => ({
      challenge: STEP_UP_CHALLENGE,
      challengeExpiresAt: now() + CHALLENGE_TTL,
    }));

    return { step: null, recoveryCodes: null };
  }

  async function removePasskey(
    auth: DevtoolsAuthenticated,
    passkeyId: string,
    meta: DevtoolsRequestMeta,
    current?: string,
  ): Promise<void> {
    requireStage(auth, "active");

    if (!auth.account.passkeys.some((passkey) => passkey.id === passkeyId))
      fail("account.not-found");

    if (
      twoFactorRequired(auth.account) &&
      auth.account.totpSecret === null &&
      auth.account.passkeys.length === 1
    ) {
      fail("account.last-factor");
    }

    await requireOwner(auth, current, meta);

    const updated = await casAccount(auth.account, (account) => {
      const remaining = account.passkeys.filter((passkey) => passkey.id !== passkeyId);

      return {
        passkeys: remaining,
        ...(remaining.length === 0 && account.totpSecret === null ? { recoveryCodes: [] } : {}),
      };
    });

    if (!updated) fail("server.error");

    await audit("passkey.removed", { auth, meta });
  }

  // -------------------------------------------------------------------------
  // Admin actions
  // -------------------------------------------------------------------------

  async function listUsers(auth: DevtoolsAuthenticated) {
    requireAdmin(auth);

    const at = now();
    const [accounts, invites] = await Promise.all([store.accounts.list(), store.invites.list()]);

    return {
      accounts: accounts.map(accountView),
      invites: invites.filter((invite) => invite.expiresAt > at).map(inviteView),
    };
  }

  async function createInvite(
    auth: DevtoolsAuthenticated,
    input: { email: string; role: DevtoolsRole },
    meta: DevtoolsRequestMeta,
  ) {
    requireAdmin(auth);

    const email = normalizeEmail(input?.email);

    if (!isPlausibleEmail(email) || (input.role !== "admin" && input.role !== "viewer")) {
      fail("input.invalid");
    }

    if (await store.accounts.findByEmail(email)) fail("invite.email-taken");

    const token = generateToken();
    const at = now();
    const invite = await store.invites.create({
      tokenHash: hashToken(token),
      email,
      role: input.role,
      createdBy: auth.account.id,
      createdAt: at,
      expiresAt: at + INVITE_TTL,
    });

    await audit("invite.created", { auth, meta, detail: { invitee: email, role: input.role } });

    return { invite: inviteView(invite), token };
  }

  async function revokeInvite(
    auth: DevtoolsAuthenticated,
    inviteId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    requireAdmin(auth);

    if (!(await store.invites.remove(inviteId))) fail("invite.invalid");

    await audit("invite.revoked", { auth, meta, detail: { invite: inviteId } });
  }

  async function targetAccount(accountId: string): Promise<DevtoolsAccountRecord> {
    const target = await store.accounts.findById(accountId);

    if (!target) fail("account.not-found");

    return target;
  }

  async function setRole(
    auth: DevtoolsAuthenticated,
    accountId: string,
    role: DevtoolsRole,
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAccountView> {
    requireAdmin(auth);

    if (role !== "admin" && role !== "viewer") fail("input.invalid");

    const target = await targetAccount(accountId);

    if (target.id === auth.account.id) fail("account.self");

    if (target.role === role) return accountView(target);

    if (target.role === "admin" && (await store.accounts.countAdmins()) <= 1) {
      fail("account.last-admin");
    }

    const updated = await casAccount(target, () => ({ role }));

    if (!updated) fail("account.not-found");

    // An admin without a second factor enrols at the next sign-in.
    if (role === "admin" && options.twoFactor === "admins" && !hasFactor(updated)) {
      await store.sessions.removeForAccount(updated.id);
    }

    await audit("account.role-changed", {
      auth,
      meta,
      detail: { target: updated.email, from: target.role, to: role },
    });

    return accountView(updated);
  }

  async function removeAccount(
    auth: DevtoolsAuthenticated,
    accountId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    requireAdmin(auth);

    const target = await targetAccount(accountId);

    if (target.id === auth.account.id) fail("account.self");

    if (target.role === "admin" && (await store.accounts.countAdmins()) <= 1) {
      fail("account.last-admin");
    }

    await store.sessions.removeForAccount(target.id);
    await store.accounts.remove(target.id);
    await audit("account.removed", { auth, meta, detail: { target: target.email } });
  }

  async function resetSecondFactor(
    auth: DevtoolsAuthenticated,
    accountId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    requireAdmin(auth);

    const target = await targetAccount(accountId);

    if (target.id === auth.account.id) fail("account.self");

    const updated = await casAccount(target, () => ({
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
      passkeys: [],
    }));

    if (!updated) fail("account.not-found");

    await store.sessions.removeForAccount(updated.id);
    await audit("account.mfa-reset", { auth, meta, detail: { target: updated.email } });
  }

  async function signOutAccount(
    auth: DevtoolsAuthenticated,
    accountId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    requireAdmin(auth);

    const target = await targetAccount(accountId);
    const removed = await store.sessions.removeForAccount(
      target.id,
      target.id === auth.account.id ? auth.session.id : undefined,
    );

    await audit("account.signed-out", {
      auth,
      meta,
      detail: { target: target.email, sessions: removed },
    });
  }

  async function disableDashboard(
    auth: DevtoolsAuthenticated,
    meta: DevtoolsRequestMeta,
  ): Promise<void> {
    requireAdmin(auth);

    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await store.state.read();
      const updated = await store.state.update(state.version, {
        disabled: true,
        disabledPathHash: hashToken(options.path),
        disabledAt: now(),
        disabledBy: auth.account.id,
      });

      if (updated) {
        await audit("dashboard.disabled", { auth, meta });

        return;
      }
    }

    fail("server.error");
  }

  return {
    ensureFirstAdmin,
    login,
    setup,
    inspectInvite,
    acceptInvite,
    authenticate,
    verifyCsrf,
    changePassword,
    startTotp,
    confirmTotp,
    removeTotp,
    verifySecondFactor,
    regenerateRecoveryCodes,
    passkeyOptions,
    verifyPasskey,
    removePasskey,
    logout,
    listSessions,
    revokeSession,
    sessionView,
    csrfToken,
    accountView,
    listUsers,
    createInvite,
    revokeInvite,
    setRole,
    removeAccount,
    resetSecondFactor,
    signOutAccount,
    disableDashboard,
    audit: (type, input) => audit(type, input),
  };
}
