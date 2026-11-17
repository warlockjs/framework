import {
  DEVTOOLS_CONFIG_CODES,
  DevtoolsProductionConfigError,
  DevtoolsStoreConflictError,
  createErrorRef,
} from "../errors";
import type { DevtoolsAccountRecord, DevtoolsStore } from "../store/types";

/** Where the commands print. */
export type CliOutput = {
  out(line: string): void;
  err(line: string): void;
};

/** What a command needs; specs pass a memory store, a fixed clock and fakes. */
export type DevtoolsCliContext = {
  store: DevtoolsStore;
  now: () => number;
  io: CliOutput;
};

export type ResetAdminContext = DevtoolsCliContext & {
  /** Returns a new random password (`generateTemporaryPassword()`). */
  generatePassword: () => string;
  /** Core's `hashPassword`. */
  hashPassword: (password: string) => Promise<string>;
};

/** The `ip` value of every audit entry a command writes. */
export const CLI_AUDIT_IP = "cli";

const MAX_WRITE_ATTEMPTS = 5;

/** Tells the owner what to do when the database cannot be used. Returns the exit code (1). */
export function reportStoreError(io: CliOutput, error: unknown): number {
  if (error instanceof DevtoolsProductionConfigError) {
    io.err(error.message);

    return 1;
  }

  const detail = error instanceof Error ? error.message : String(error);

  io.err(
    `Could not use the database: ${detail}. Check that the database is reachable and its settings are correct, then run the command again. ` +
      `If the tables are missing: ${DEVTOOLS_CONFIG_CODES.DT008}`,
  );

  return 1;
}

/**
 * `warlock devtools:enable`: clears the disable flag and the global lock and
 * stops earlier failures from counting. Returns the exit code.
 */
export async function runEnable(context: DevtoolsCliContext): Promise<number> {
  const { store, now, io } = context;

  try {
    await store.verify();

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const state = await store.state.read();
      const at = now();
      const updated = await store.state.update(state.version, {
        disabled: false,
        disabledPathHash: null,
        lockedUntil: null,
        failuresResetAt: at,
      });

      if (!updated) continue;

      await store.audit.append({
        at,
        type: "dashboard.enabled",
        accountId: null,
        email: null,
        ip: CLI_AUDIT_IP,
        userAgent: null,
        detail: {
          wasDisabled: state.disabled,
          wasLocked: state.lockedUntil !== null && state.lockedUntil > at,
        },
        ref: createErrorRef(),
      });

      io.out(
        [
          "The devtools dashboard is enabled.",
          state.disabled ? "- The disable switch is cleared." : "- The disable switch was not set.",
          state.lockedUntil !== null && state.lockedUntil > at
            ? "- The global lock is cleared."
            : "- The dashboard was not locked.",
          "- Earlier failed sign-ins no longer count toward the limits.",
        ].join("\n"),
      );

      return 0;
    }

    io.err(
      "Another process kept changing the dashboard state, so nothing was saved. Run `warlock devtools:enable` again.",
    );

    return 1;
  } catch (error) {
    return reportStoreError(io, error);
  }
}

/** Normalises the `--email` option or `DEVTOOLS_ADMIN_EMAIL`. Returns `null` when there is none. */
export function resolveAdminEmail(
  option: unknown,
  env: Record<string, string | undefined>,
): string | null {
  const raw =
    typeof option === "string" && option.trim() !== "" ? option : env.DEVTOOLS_ADMIN_EMAIL;
  const email = raw?.trim().toLowerCase() ?? "";

  return email === "" ? null : email;
}

/**
 * `warlock devtools:reset-admin`: creates the admin account or resets it to a
 * printed temporary password, without second factors, and signs it out
 * everywhere. Returns the exit code.
 */
export async function runResetAdmin(
  context: ResetAdminContext,
  email: string | null,
): Promise<number> {
  const { store, now, io, generatePassword, hashPassword } = context;

  if (email === null || !email.includes("@")) {
    io.err(
      email === null
        ? "No email was given. Run `warlock devtools:reset-admin --email <email>`, or set DEVTOOLS_ADMIN_EMAIL."
        : `"${email}" is not an email address. Run \`warlock devtools:reset-admin --email <email>\` with a valid address.`,
    );

    return 1;
  }

  try {
    await store.verify();

    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const at = now();
      const existing = await store.accounts.findByEmail(email);
      const account = existing
        ? await store.accounts.update(existing.id, existing.version, {
            role: "admin",
            passwordHash,
            passwordSource: "reset",
            mustChangePassword: true,
            totpSecret: null,
            totpEnabledAt: null,
            totpLastStep: null,
            recoveryCodes: [],
            passkeys: [],
            failuresResetAt: at,
          })
        : await createAdmin(store, email, passwordHash, at);

      if (!account) continue;

      const signedOut = await store.sessions.removeForAccount(account.id);

      await store.audit.append({
        at,
        type: "admin.reset",
        accountId: account.id,
        email,
        ip: CLI_AUDIT_IP,
        userAgent: null,
        detail: { created: existing === null, sessionsRemoved: signedOut },
        ref: createErrorRef(),
      });

      io.out(
        [
          existing
            ? `The admin account ${email} was reset.`
            : `The admin account ${email} was created.`,
          `Temporary password: ${password}`,
          "Sign in with it; the dashboard asks for a new password and a second factor.",
          signedOut > 0
            ? `${signedOut} open session(s) were signed out.`
            : "The account had no open sessions.",
        ].join("\n"),
      );

      return 0;
    }

    io.err(
      `Another process kept changing the account ${email}, so nothing was saved. Run the command again.`,
    );

    return 1;
  } catch (error) {
    return reportStoreError(io, error);
  }
}

/** Creates the account; `null` when another process created it first (the caller retries as a reset). */
async function createAdmin(
  store: DevtoolsStore,
  email: string,
  passwordHash: string,
  at: number,
): Promise<DevtoolsAccountRecord | null> {
  try {
    return await store.accounts.create({
      email,
      role: "admin",
      passwordHash,
      passwordSource: "reset",
      mustChangePassword: true,
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
      passkeys: [],
      failuresResetAt: at,
      lastLoginAt: null,
      createdBy: null,
    });
  } catch (error) {
    if (error instanceof DevtoolsStoreConflictError) return null;

    throw error;
  }
}
