import { describe, expect, it } from "vitest";
import { compareCreatedAt, parseCreatedAt } from "../../../src/migration/parse-created-at";
import { SQLGrammar } from "../../../src/migration/sql-grammar";
import type { TaggedSQL } from "../../../src/migration/types";

/**
 * Regression cover for the migration ordering bug reported from TeamsUp on
 * 2026-08-05 (`plans/2026-08-05-cascade-migration-sort-order-bug.md`).
 *
 * `SQLGrammar.sort` parsed `createdAt` with `new Date()`, which cannot read
 * the `MM-DD-YYYY_HH-MM-SS` stamp the framework's own generator produces.
 * Every timestamp became `NaN`, was floored to `0`, and the comparator fell
 * through to its alphabetical tiebreaker — so migrations ran in filename
 * order on any fresh database.
 *
 * Every ordering case below is written so the alphabetical fallback produces
 * the WRONG answer. A passing test therefore cannot be passing by accident.
 */

const statement = (
  createdAt: string | undefined,
  migrationName: string,
  phase: TaggedSQL["phase"] = 3,
): TaggedSQL =>
  ({
    sql: `ALTER TABLE ${migrationName} ADD COLUMN example TEXT`,
    phase,
    statementType: "alter",
    createdAt,
    migrationName,
  }) as TaggedSQL;

const order = (statements: TaggedSQL[]) =>
  SQLGrammar.sort(statements).map((entry) => entry.migrationName);

describe("parseCreatedAt", () => {
  it("parses the MM-DD-YYYY_HH-MM-SS stamp the generator produces", () => {
    // The exact format that `new Date()` returns Invalid Date for.
    expect(new Date("08-04-2026_18-12-00").getTime()).toBeNaN();

    const parsed = parseCreatedAt("08-04-2026_18-12-00");

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(7); // August, zero-indexed
    expect(parsed?.getDate()).toBe(4);
    expect(parsed?.getHours()).toBe(18);
    expect(parsed?.getMinutes()).toBe(12);
  });

  it("reads a first field above 12 as a day (DD-MM-YYYY)", () => {
    const parsed = parseCreatedAt("22-12-2025_10-30-20");

    expect(parsed?.getMonth()).toBe(11); // December
    expect(parsed?.getDate()).toBe(22);
  });

  it("still accepts ISO strings", () => {
    expect(parseCreatedAt("2026-01-08T00:00:00.000Z")?.toISOString()).toBe(
      "2026-01-08T00:00:00.000Z",
    );
  });

  it("returns undefined for an unusable stamp", () => {
    expect(parseCreatedAt("not-a-date")).toBeUndefined();
    expect(parseCreatedAt("")).toBeUndefined();
  });
});

describe("compareCreatedAt", () => {
  it("orders a parseable stamp before an unparseable one", () => {
    expect(compareCreatedAt("08-04-2026_18-12-00", "garbage")).toBe(-1);
    expect(compareCreatedAt("garbage", "08-04-2026_18-12-00")).toBe(1);
  });

  it("declines to decide when neither stamp is usable", () => {
    expect(compareCreatedAt(undefined, undefined)).toBeUndefined();
    expect(compareCreatedAt("garbage", "nonsense")).toBeUndefined();
  });

  it("declines to decide when the stamps are equal, leaving the tiebreaker", () => {
    expect(compareCreatedAt("08-04-2026_18-12-00", "08-04-2026_18-12-00")).toBeUndefined();
  });
});

describe("SQLGrammar.sort", () => {
  it("orders by creation date across a year boundary, not by filename", () => {
    // The reported case: alphabetically "01-08-2026…" sorts before
    // "12-22-2025…", so a January 2026 migration ran before a December 2025 one.
    const statements = [
      statement("12-22-2025_10-30-20", "z-created-first"),
      statement("01-08-2026_00-00-00", "a-created-second"),
    ];

    expect(order(statements)).toEqual(["z-created-first", "a-created-second"]);
  });

  it("is not fooled by input order", () => {
    const statements = [
      statement("01-08-2026_00-00-00", "a-created-second"),
      statement("12-22-2025_10-30-20", "z-created-first"),
    ];

    expect(order(statements)).toEqual(["z-created-first", "a-created-second"]);
  });

  it("keeps phase as the primary key, ahead of any timestamp", () => {
    // An older ALTER must still run after a newer CREATE TABLE.
    const statements = [
      statement("12-22-2025_10-30-20", "z-older-alter", 3),
      statement("01-08-2026_00-00-00", "a-newer-create", 2),
    ];

    expect(order(statements)).toEqual(["a-newer-create", "z-older-alter"]);
  });

  it("orders the TeamsUp otps collision correctly", () => {
    // The create migration adds the FK constraint; the cascade migration drops
    // and re-adds it. Running the cascade first made the create fail with
    // "already exists".
    //
    // The names carry z-/a- prefixes so alphabetical order disagrees with the
    // intended one. With the real names ("otp-migration", "otp-user-cascade")
    // the alphabetical fallback happens to produce the right answer, and this
    // test would pass against the unfixed code — proving nothing.
    const statements = [
      statement("22-12-2025_10-30-20", "z-otp-migration", 4),
      statement("01-08-2026_12-00-00", "a-otp-user-cascade", 4),
    ];

    expect(order(statements)).toEqual(["z-otp-migration", "a-otp-user-cascade"]);
  });

  it("falls back to the name only when timestamps cannot decide", () => {
    const statements = [
      statement(undefined, "b-second"),
      statement(undefined, "a-first"),
    ];

    expect(order(statements)).toEqual(["a-first", "b-second"]);
  });

  it("uses the name when two migrations share a timestamp", () => {
    const statements = [
      statement("08-04-2026_18-12-00", "b-second"),
      statement("08-04-2026_18-12-00", "a-first"),
    ];

    expect(order(statements)).toEqual(["a-first", "b-second"]);
  });

  it("orders a stamped migration before an unstamped one", () => {
    const statements = [
      statement(undefined, "a-unstamped"),
      statement("12-22-2025_10-30-20", "z-stamped"),
    ];

    expect(order(statements)).toEqual(["z-stamped", "a-unstamped"]);
  });

  it("orders a generator stamp against an ISO stamp by real time", () => {
    // Mixed formats were the second failure mode: the generator format floored
    // to 0 while an ISO stamp parsed to a real timestamp, so EVERY
    // generator-stamped migration sorted ahead of every ISO-stamped one
    // regardless of date. The ISO one here is genuinely older, so the unfixed
    // comparator gets it backwards.
    const statements = [
      statement("2026-01-05T00:00:00.000Z", "z-iso-older"),
      statement("06-01-2026_00-00-00", "a-generator-newer"),
    ];

    expect(order(statements)).toEqual(["z-iso-older", "a-generator-newer"]);
  });

  it("does not mutate the array it was given", () => {
    const statements = [
      statement("01-08-2026_00-00-00", "a-created-second"),
      statement("12-22-2025_10-30-20", "z-created-first"),
    ];

    SQLGrammar.sort(statements);

    expect(statements.map((entry) => entry.migrationName)).toEqual([
      "a-created-second",
      "z-created-first",
    ]);
  });
});
