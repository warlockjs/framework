import { log } from "@warlock.js/logger";
import { config } from "../config";
import { type EncryptionPasswordConfigurations } from "./types";

/**
 * Default bcrypt salt rounds.
 */
const DEFAULT_SALT_ROUNDS = 12;

/**
 * bcrypt uses only the first 72 bytes (UTF-8) of a password.
 */
const BCRYPT_MAX_BYTES = 72;

/**
 * Hashes the native `bcrypt` module verifies: `$2a$` / `$2b$` with a
 * two-digit cost and the 53-character salt + digest. Anything else (such as
 * `$2y$`, or a value that is not a bcrypt hash) is verified by bcryptjs.
 */
const NATIVE_HASH_PATTERN = /^\$2[ab]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// ============================================================
// Lazy-loaded bcrypt backends
// ============================================================

/**
 * The part of a bcrypt implementation the helpers use. bcryptjs and the
 * native `bcrypt` module both provide it and produce interchangeable hashes.
 */
type BcryptBackend = {
  hash(password: string, rounds: number): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
};

/**
 * Cached bcryptjs module (loaded once, reused)
 */
let Bcryptjs: typeof import("bcryptjs");

let isModuleExists: boolean | null = null;

/**
 * The native `bcrypt` module, when the app has installed it. It hashes on the
 * libuv thread pool instead of the event loop.
 */
let nativeBcrypt: BcryptBackend | null = null;

/**
 * Whether the over-72-byte warning was already logged.
 */
let warnedLongPassword = false;

/**
 * Installation instructions for bcryptjs package
 */
const BCRYPTJS_INSTALL_INSTRUCTIONS = `
Password encryption requires the bcryptjs package.
Install it with:

  yarn add bcryptjs

Or with your preferred package manager:

  npm install bcryptjs
  pnpm add bcryptjs
  yarn add bcryptjs
`.trim();

/**
 * Load the native `bcrypt` module if the app installed it. It is optional:
 * the framework does not depend on it.
 */
async function loadNativeBcrypt(): Promise<BcryptBackend | null> {
  // A variable specifier keeps bundlers and the type checker from requiring
  // the optional module to exist.
  const specifier = "bcrypt";

  try {
    const loaded = await import(/* @vite-ignore */ specifier);
    const candidate = (loaded?.default ?? loaded) as Partial<BcryptBackend> | undefined;

    if (typeof candidate?.hash === "function" && typeof candidate?.compare === "function") {
      return candidate as BcryptBackend;
    }
  } catch {
    // Not installed (or failed to build): bcryptjs is used.
  }

  return null;
}

/**
 * Load bcryptjs module
 */
async function loadBcryptjs() {
  nativeBcrypt = await loadNativeBcrypt();

  try {
    Bcryptjs = await import("bcryptjs");
    isModuleExists = true;
  } catch {
    isModuleExists = false;
  }
}

const bcryptjsLoading = loadBcryptjs();

/**
 * Warn (once) or refuse when bcrypt would ignore part of the password.
 */
function guardPasswordLength(password: string): void {
  if (Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_BYTES) return;

  const reject = config.key<EncryptionPasswordConfigurations["rejectLongPasswords"]>(
    "encryption.password.rejectLongPasswords",
    false,
  );

  if (reject) {
    throw new Error(
      `Password is too long: bcrypt uses only the first ${BCRYPT_MAX_BYTES} bytes. Use a shorter password (limit its length in your validation rules), or turn off encryption.password.rejectLongPasswords.`,
    );
  }

  if (warnedLongPassword) return;

  warnedLongPassword = true;

  log.warn(
    "encryption",
    "password",
    `hashPassword() received a password longer than ${BCRYPT_MAX_BYTES} bytes; bcrypt ignores everything after byte ${BCRYPT_MAX_BYTES}. Limit password length in your validation rules, or set encryption.password.rejectLongPasswords: true to refuse such passwords.`,
  );
}

/**
 * Hashes a password using bcrypt (async — does not block the event loop).
 *
 * Uses the native `bcrypt` module when the app has installed it (hashing runs
 * on the libuv thread pool), otherwise bcryptjs. Both produce the same hash
 * format, so either one verifies the other's hashes.
 *
 * Salt rounds are read from \`encryption.password.salt\` config,
 * defaulting to 12. bcrypt ignores everything after the first 72 bytes of a
 * password: a longer one logs a one-time warning, or is refused when
 * \`encryption.password.rejectLongPasswords\` is `true`.
 *
 * @example
 * import { hashPassword } from "@warlock.js/core";
 *
 * const hashed = await hashPassword("user-password-123");
 * // Store \`hashed\` in the database
 */
export async function hashPassword(password: string): Promise<string> {
  await bcryptjsLoading;

  if (!isModuleExists && !nativeBcrypt) {
    throw new Error(BCRYPTJS_INSTALL_INSTRUCTIONS);
  }

  const plain = String(password);

  guardPasswordLength(plain);

  const saltRounds = config.key<EncryptionPasswordConfigurations["salt"]>(
    "encryption.password.salt",
    DEFAULT_SALT_ROUNDS,
  )!;

  if (nativeBcrypt) {
    return nativeBcrypt.hash(plain, saltRounds);
  }

  return Bcryptjs.hash(plain, saltRounds);
}

/**
 * Verifies a plain password against a bcrypt hash (async — does not block the event loop).
 *
 * @example
 * import { verifyPassword } from "@warlock.js/core";
 *
 * const isValid = await verifyPassword("user-password-123", storedHash);
 */
export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  await bcryptjsLoading;

  const hash = String(hashedPassword);

  if (nativeBcrypt && (NATIVE_HASH_PATTERN.test(hash) || !isModuleExists)) {
    return nativeBcrypt.compare(String(plainPassword), hash);
  }

  if (!isModuleExists) {
    throw new Error(BCRYPTJS_INSTALL_INSTRUCTIONS);
  }

  return Bcryptjs.compare(String(plainPassword), hash);
}
