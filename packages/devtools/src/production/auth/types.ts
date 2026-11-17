import type {
  DevtoolsAccountView,
  DevtoolsAuditType,
  DevtoolsCreatedInvite,
  DevtoolsInstanceInfo,
  DevtoolsRole,
  DevtoolsSessionInfo,
  DevtoolsSessionStage,
  DevtoolsSessionView,
  DevtoolsTotpEnrolment,
  DevtoolsUserListView,
} from "../contracts";
import type { ResolvedDevtoolsProductionOptions } from "../options";
import type { DevtoolsAccountRecord, DevtoolsSessionRecord, DevtoolsStore } from "../store/types";

/** What the HTTP layer knows about the caller, after trusted-proxy resolution. */
export type DevtoolsRequestMeta = {
  /** The client IP (see `resolveClientIp`). */
  ip: string;
  /** At most 200 characters; `null` when absent. */
  userAgent: string | null;
  /** The expected origin: `production.origin`, else `<proto>://<host>` of the request. */
  origin: string;
  /** The host name (no port) the request addressed; the passkey relying party id when none is configured. */
  hostname: string;
};

/** A request's session, once its cookie token matched a live session. */
export type DevtoolsAuthenticated = {
  session: DevtoolsSessionRecord;
  account: DevtoolsAccountRecord;
  stage: Exclude<DevtoolsSessionStage, "signed-out">;
};

/**
 * The outcome of a sign-in step. `token` is set when a NEW session was minted
 * (login, setup, invite, and every move to `active`): the HTTP layer sets it
 * as the cookie. `csrf` is the raw CSRF token of the session now in force.
 */
export type DevtoolsAuthStep = {
  stage: Exclude<DevtoolsSessionStage, "signed-out">;
  /** The raw cookie token when the session changed, else `null` (keep the cookie). */
  token: string | null;
  csrf: string;
  session: DevtoolsSessionRecord;
};

/**
 * Crypto the service uses, injected so specs run without core's config.
 * Defaults (`defaultDevtoolsCrypto()`): core's `hashPassword`,
 * `verifyPassword`, `encrypt`, `decrypt`, and core's TOTP helpers.
 */
export type DevtoolsCrypto = {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  generateTotpSecret(): string;
  /** Returns the matched time step, or `null` when the code is not valid in the ±1 step window. */
  verifyTotp(secret: string, code: string, at: number): number | null;
  totpUri(input: { secret: string; account: string; issuer: string }): string;
  /** HMAC-SHA256 keyed with the app key (core's `hmacHash`): derives CSRF tokens. */
  hmac(value: string): string;
};

/**
 * Passkey ceremonies (WebAuthn), backed by `@simplewebauthn/server` when it is
 * installed. `null` from `loadDevtoolsPasskeys()` means passkeys are off.
 */
export type DevtoolsPasskeys = {
  registrationOptions(input: {
    account: DevtoolsAccountRecord;
    rpId: string;
    rpName: string;
  }): Promise<{ options: unknown; challenge: string }>;
  verifyRegistration(input: {
    response: unknown;
    challenge: string;
    origin: string;
    rpId: string;
  }): Promise<{ id: string; publicKey: string; counter: number; transports: string[] }>;
  authenticationOptions(input: {
    account: DevtoolsAccountRecord;
    rpId: string;
  }): Promise<{ options: unknown; challenge: string }>;
  verifyAuthentication(input: {
    response: unknown;
    challenge: string;
    origin: string;
    rpId: string;
    account: DevtoolsAccountRecord;
  }): Promise<{ id: string; newCounter: number }>;
};

/** What `createDevtoolsAuth` needs. */
export type DevtoolsAuthDeps = {
  store: DevtoolsStore;
  options: ResolvedDevtoolsProductionOptions;
  instance: DevtoolsInstanceInfo;
  crypto: DevtoolsCrypto;
  /** `null` when `@simplewebauthn/server` is not installed. */
  passkeys: DevtoolsPasskeys | null;
  now?: () => number;
  /** Writes one line to the server log (no secrets). */
  warn?: (message: string) => void;
};

/**
 * Accounts, sessions, two-factor, invites, rate limits and the audit log.
 * Plain async functions over the store: no HTTP. Every rejection throws a
 * `DevtoolsApiError` with the code the route answers with.
 *
 * Owner: WP-2.
 */
export interface DevtoolsAuthService {
  /**
   * Seeds the first admin from the environment when no admin exists
   * (password: `passwordSource "env"`, `mustChangePassword`; setup token: a
   * placeholder hash that matches nothing, `passwordSource "setup"`). When the
   * env admin exists and still has `passwordSource "env"`, a changed
   * `DEVTOOLS_ADMIN_PASSWORD` replaces the stored hash. Throws
   * `DevtoolsProductionConfigError` DT003 (no admin and no env admin) or
   * DT004 (env password fails the rules).
   */
  ensureFirstAdmin(): Promise<void>;

  /** Email + password. Rate limits, lock and timing equalization apply. */
  login(
    input: { email: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep>;
  /** First admin password from `DEVTOOLS_SETUP_TOKEN` (constant-time compare), only while that admin's source is `setup`. */
  setup(
    input: { token: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep>;
  /** The email and role of a valid unused invite (`invite.invalid` otherwise). */
  inspectInvite(token: string): Promise<{ email: string; role: DevtoolsRole }>;
  acceptInvite(
    input: { token: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep>;

  /**
   * The session for a cookie token: `null` when missing, unknown, past
   * `expiresAt`, idle for longer than `idleMinutes`, or its account is gone.
   * Updates `lastSeenAt` at most once a minute.
   */
  authenticate(token: string | undefined): Promise<DevtoolsAuthenticated | null>;
  /** Constant-time check of the `X-Devtools-Csrf` header against `csrfToken(session)`. */
  verifyCsrf(auth: DevtoolsAuthenticated, header: string | undefined): boolean;

  /** Stage `password-change` (no current password needed) or an active session (current password needed). */
  changePassword(
    auth: DevtoolsAuthenticated,
    input: { current?: string; password: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep>;
  /** Starts (or restarts) TOTP enrolment: stage `mfa-enrol`, or an active session adding an app. */
  startTotp(auth: DevtoolsAuthenticated, meta: DevtoolsRequestMeta): Promise<DevtoolsTotpEnrolment>;
  /** Confirms the pending secret with a code; returns new recovery codes when the account had none. */
  confirmTotp(
    auth: DevtoolsAuthenticated,
    code: string,
    meta: DevtoolsRequestMeta,
  ): Promise<{ step: DevtoolsAuthStep; recoveryCodes: string[] | null }>;
  /** Removes the authenticator app (`account.last-factor` when it is the only factor and one is required). */
  removeTotp(auth: DevtoolsAuthenticated, meta: DevtoolsRequestMeta): Promise<void>;
  /** Stage `mfa-verify`: a TOTP code or a recovery code. Failures count toward the limits. */
  verifySecondFactor(
    auth: DevtoolsAuthenticated,
    input: { code?: string; recoveryCode?: string },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAuthStep>;
  /** Replaces the recovery codes; needs a current TOTP code (or a passkey step done in this session within 5 minutes). */
  regenerateRecoveryCodes(
    auth: DevtoolsAuthenticated,
    code: string,
    meta: DevtoolsRequestMeta,
  ): Promise<string[]>;

  /** WebAuthn options for registering (stage `mfa-enrol` or active) or signing in (stage `mfa-verify`). `passkey.unavailable` when off. */
  passkeyOptions(
    auth: DevtoolsAuthenticated,
    purpose: "register" | "login",
    meta: DevtoolsRequestMeta,
  ): Promise<unknown>;
  /** Verifies a passkey answer; for `login` and for the first factor at enrolment, returns the next step. */
  verifyPasskey(
    auth: DevtoolsAuthenticated,
    purpose: "register" | "login",
    response: unknown,
    meta: DevtoolsRequestMeta,
  ): Promise<{ step: DevtoolsAuthStep | null; recoveryCodes: string[] | null }>;
  removePasskey(
    auth: DevtoolsAuthenticated,
    passkeyId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void>;

  logout(auth: DevtoolsAuthenticated, meta: DevtoolsRequestMeta): Promise<void>;
  listSessions(auth: DevtoolsAuthenticated): Promise<DevtoolsSessionInfo[]>;
  revokeSession(
    auth: DevtoolsAuthenticated,
    sessionId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void>;

  /** The session view for `GET api/auth/session`, with the session's CSRF token (the same for every tab). */
  sessionView(auth: DevtoolsAuthenticated | null): DevtoolsSessionView;
  /** The session's CSRF token: HMAC(app key, `<session id>:<csrfSecret>`). */
  csrfToken(session: DevtoolsSessionRecord): string;
  accountView(account: DevtoolsAccountRecord): DevtoolsAccountView;

  // Admin actions: `role.forbidden` unless `auth.account.role === "admin"` and stage `active`.
  listUsers(auth: DevtoolsAuthenticated): Promise<DevtoolsUserListView>;
  createInvite(
    auth: DevtoolsAuthenticated,
    input: { email: string; role: DevtoolsRole },
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsCreatedInvite>;
  revokeInvite(
    auth: DevtoolsAuthenticated,
    inviteId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void>;
  setRole(
    auth: DevtoolsAuthenticated,
    accountId: string,
    role: DevtoolsRole,
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsAccountView>;
  removeAccount(
    auth: DevtoolsAuthenticated,
    accountId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void>;
  resetSecondFactor(
    auth: DevtoolsAuthenticated,
    accountId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void>;
  signOutAccount(
    auth: DevtoolsAuthenticated,
    accountId: string,
    meta: DevtoolsRequestMeta,
  ): Promise<void>;
  /** Sets the disable flag for the current path (every instance closes within the state cache TTL). */
  disableDashboard(auth: DevtoolsAuthenticated, meta: DevtoolsRequestMeta): Promise<void>;

  /** Appends an audit entry and returns its `ref`. Never throws (a failed write is logged). */
  audit(
    type: DevtoolsAuditType,
    input: {
      auth?: DevtoolsAuthenticated | null;
      accountId?: string | null;
      email?: string | null;
      meta?: DevtoolsRequestMeta | null;
      detail?: Record<string, string | number | boolean | null>;
    },
  ): Promise<string>;
}
