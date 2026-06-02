import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Modern ID format validators — UUID, CUID, ULID, nanoid.
 *
 * Each rule asserts the value is a string in the canonical format for its
 * identifier scheme. Rules are intentionally strict (variant nibbles checked
 * for UUID, character classes enforced for ULID's Crockford base32, etc.)
 * so "looks-like-but-not-valid" inputs are rejected.
 */

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_BY_VERSION: Record<1 | 3 | 4 | 5 | 6 | 7, RegExp> = {
  1: /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  3: /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  5: /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  6: /^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

export type UUIDVersion = 1 | 3 | 4 | 5 | 6 | 7;

/**
 * UUID rule — value must be a valid UUID. Optionally restrict to a specific version.
 *
 * @example
 * v.string().uuid()       // any RFC 4122 UUID
 * v.string().uuid(4)      // only v4 (random)
 * v.string().uuid(7)      // only v7 (timestamp-ordered)
 */
export const uuidRule: SchemaRule<{ version?: UUIDVersion }> = {
  name: "uuid",
  defaultErrorMessage: "The :input must be a valid UUID",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);

    const version = this.context.options.version;

    const pattern = version ? UUID_BY_VERSION[version] : UUID_ANY;
    if (pattern.test(value)) return VALID_RULE;

    if (version !== undefined) {
      this.context.translationParams.version = version;
    }

    return invalidRule(this, context);
  },
};

/**
 * CUID rule — value must be a valid CUID.
 *
 * Defaults to CUID2 (24 chars, lowercase, starts with letter — see
 * https://github.com/paralleldrive/cuid2). Pass `{ version: 1 }` for legacy
 * CUID1 format (starts with "c", ≥25 chars).
 *
 * @example
 * v.string().cuid()                  // CUID2
 * v.string().cuid({ version: 1 })    // legacy CUID1
 */
export const cuidRule: SchemaRule<{ version?: 1 | 2 }> = {
  name: "cuid",
  defaultErrorMessage: "The :input must be a valid CUID",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    const version = this.context.options.version ?? 2;
    const pattern = version === 1 ? /^c[a-z0-9]{24,}$/ : /^[a-z][a-z0-9]{23}$/;
    if (pattern.test(value)) return VALID_RULE;
    this.context.translationParams.version = version;
    return invalidRule(this, context);
  },
};

/**
 * ULID rule — value must be a valid ULID (26 chars, Crockford base32).
 *
 * Crockford base32 excludes the letters I, L, O, U to avoid ambiguity.
 *
 * @example
 * v.string().ulid()
 */
export const ulidRule: SchemaRule = {
  name: "ulid",
  defaultErrorMessage: "The :input must be a valid ULID",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) return VALID_RULE;
    return invalidRule(this, context);
  },
};

/**
 * nanoid rule — value must be a valid nanoid string.
 *
 * Default length is 21 (standard nanoid). URL-safe alphabet:
 * A–Z, a–z, 0–9, `_`, `-`.
 *
 * @example
 * v.string().nanoid()         // 21 chars (default)
 * v.string().nanoid(10)       // 10 chars
 */
export const nanoidRule: SchemaRule<{ length?: number }> = {
  name: "nanoid",
  defaultErrorMessage: "The :input must be a valid nanoid",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    const length = this.context.options.length ?? 21;
    const pattern = new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
    if (pattern.test(value)) return VALID_RULE;
    this.context.translationParams.length = length;
    return invalidRule(this, context);
  },
};
