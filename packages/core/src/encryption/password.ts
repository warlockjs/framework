import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
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

/**
 * scrypt hashes are stored as `$scrypt$N=<cost>,r=<blockSize>,p=<parallelization>$<salt>$<hash>`
 * (salt and hash in base64).
 */
const SCRYPT_HASH_PATTERN =
  /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

/** A complete bcrypt hash of any supported version. */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_DEFAULTS = { cost: 32768, blockSize: 8, parallelization: 1 };

/** The bcrypt cost in a `$2a$` / `$2b$` / `$2y$` hash. */
const BCRYPT_COST_PATTERN = /^\$2[aby]\$(\d{2})\$/;

type ScryptParams = { cost: number; blockSize: number; parallelization: number };

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

function getDriver(): "bcrypt" | "scrypt" {
  return config.key<EncryptionPasswordConfigurations["driver"]>(
    "encryption.password.driver",
    "bcrypt",
  ) === "scrypt"
    ? "scrypt"
    : "bcrypt";
}

function getScryptParams(): ScryptParams {
  const configured = config.key<EncryptionPasswordConfigurations["scrypt"]>(
    "encryption.password.scrypt",
  );

  return {
    cost: configured?.cost ?? SCRYPT_DEFAULTS.cost,
    blockSize: configured?.blockSize ?? SCRYPT_DEFAULTS.blockSize,
    parallelization: configured?.parallelization ?? SCRYPT_DEFAULTS.parallelization,
  };
}

/** Derive a scrypt key on the libuv thread pool. */
function deriveScrypt(plain: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      plain.normalize("NFKC"),
      salt,
      SCRYPT_KEY_BYTES,
      {
        N: params.cost,
        r: params.blockSize,
        p: params.parallelization,
        // scrypt needs about 128 * N * r bytes; leave headroom over Node's 32 MB default.
        maxmem: 256 * params.cost * params.blockSize,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

async function hashWithScrypt(plain: string): Promise<string> {
  const params = getScryptParams();
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = await deriveScrypt(plain, salt, params);

  return `$scrypt$N=${params.cost},r=${params.blockSize},p=${params.parallelization}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyScrypt(plain: string, hash: string): Promise<boolean> {
  const match = SCRYPT_HASH_PATTERN.exec(hash);

  if (!match) return false;

  const params: ScryptParams = {
    cost: Number(match[1]),
    blockSize: Number(match[2]),
    parallelization: Number(match[3]),
  };
  const expected = Buffer.from(match[5]!, "base64");

  try {
    const actual = await deriveScrypt(plain, Buffer.from(match[4]!, "base64"), params);

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    // Parameters the runtime refuses (not a power of two, too large): not a match.
    return false;
  }
}

/**
 * Whether a value is already a password hash in a format `verifyPassword()`
 * understands: bcrypt (`$2a$`, `$2b$`, `$2y$`) or scrypt (`$scrypt$...`).
 * A plain password, an empty string or any other format answers `false`.
 *
 * @example
 * import { isPasswordHash } from "@warlock.js/core";
 *
 * isPasswordHash("$scrypt$N=32768,r=8,p=1$c2FsdA==$aGFzaA=="); // true
 * isPasswordHash("my-password"); // false
 */
export function isPasswordHash(value: unknown): boolean {
  if (typeof value !== "string") return false;

  return BCRYPT_HASH_PATTERN.test(value) || SCRYPT_HASH_PATTERN.test(value);
}

/**
 * Whether a stored hash should be replaced by a fresh one: it was made with
 * another algorithm than `encryption.password.driver`, or with another cost
 * than `encryption.password.salt` (bcrypt) / `encryption.password.scrypt`.
 * A value in no known format answers `false`, so it is never rewritten.
 *
 * @example
 * import { needsRehash, hashPassword, verifyPassword } from "@warlock.js/core";
 *
 * if (await verifyPassword(plain, user.password) && needsRehash(user.password)) {
 *   user.password = await hashPassword(plain);
 * }
 */
export function needsRehash(hashedPassword: string): boolean {
  const hash = String(hashedPassword);
  const driver = getDriver();
  const scryptMatch = SCRYPT_HASH_PATTERN.exec(hash);

  if (scryptMatch) {
    if (driver !== "scrypt") return true;

    const wanted = getScryptParams();

    return (
      Number(scryptMatch[1]) !== wanted.cost ||
      Number(scryptMatch[2]) !== wanted.blockSize ||
      Number(scryptMatch[3]) !== wanted.parallelization
    );
  }

  const bcryptMatch = BCRYPT_COST_PATTERN.exec(hash);

  if (!bcryptMatch) return false;

  if (driver === "scrypt") return true;

  const wanted = config.key<EncryptionPasswordConfigurations["salt"]>(
    "encryption.password.salt",
    DEFAULT_SALT_ROUNDS,
  )!;

  return Number(bcryptMatch[1]) !== wanted;
}

/**
 * Hashes a password using bcrypt (async — does not block the event loop), or
 * scrypt when `encryption.password.driver` is `"scrypt"`.
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
  if (getDriver() === "scrypt") return hashWithScrypt(String(password));

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
 * Verifies a plain password against a bcrypt or scrypt hash (async — does not block the event loop).
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
  const hash = String(hashedPassword);

  if (hash.startsWith("$scrypt$")) return verifyScrypt(String(plainPassword), hash);

  await bcryptjsLoading;

  if (nativeBcrypt && (NATIVE_HASH_PATTERN.test(hash) || !isModuleExists)) {
    return nativeBcrypt.compare(String(plainPassword), hash);
  }

  if (!isModuleExists) {
    throw new Error(BCRYPTJS_INSTALL_INSTRUCTIONS);
  }

  return Bcryptjs.compare(String(plainPassword), hash);
}
