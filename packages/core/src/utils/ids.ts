import { randomBytes, randomUUID } from "node:crypto";

/**
 * Identifier generation the test kit can make deterministic.
 *
 * Generate ids through `ids` instead of calling `crypto.randomUUID()` directly
 * where a test needs to predict them (a snapshot, a file name, a link). In the
 * test environment `idsFake` from `@warlock.js/core/tests` replaces the source
 * with a numbered sequence; in every other environment the values come from
 * `node:crypto`.
 *
 * @example
 * import { ids } from "@warlock.js/core";
 *
 * const reference = ids.uuid();
 * const resetToken = ids.token(48);
 */
export type IdsSource = {
  /** A version 4 UUID. */
  uuid(): string;
  /** A URL-safe random string of exactly `length` characters. */
  token(length: number): string;
};

const cryptoIds: IdsSource = {
  uuid: () => randomUUID(),
  token: (length) =>
    randomBytes(Math.ceil((length * 3) / 4) + 1)
      .toString("base64url")
      .slice(0, length),
};

const SOURCE_KEY = Symbol.for("warlock.core.idsSource");

type SourceHolder = { [SOURCE_KEY]?: IdsSource };

function source(): IdsSource {
  return (globalThis as SourceHolder)[SOURCE_KEY] ?? cryptoIds;
}

export const ids = {
  /** A version 4 UUID. */
  uuid(): string {
    return source().uuid();
  },

  /** A URL-safe random string, 32 characters unless `length` says otherwise. */
  token(length = 32): string {
    if (!Number.isInteger(length) || length < 1) {
      throw new RangeError(`ids.token(length) needs a positive integer, got ${String(length)}.`);
    }

    return source().token(length);
  },
};

/**
 * Replace the id source, or restore `node:crypto` with `undefined`.
 * The test kit's `idsFake` is built on this.
 */
export function setIdsSource(next: IdsSource | undefined): void {
  (globalThis as SourceHolder)[SOURCE_KEY] = next;
}
