import { describe, expect, it } from "vitest";
import {
  sortMigrations,
  sortMigrationsForRollback,
} from "../../../src/migration/migration-order";

/**
 * Regression cover for the rollback ordering bug reported from kafr-yasef on
 * 2026-08-09 (`plans/2026-08-09-cascade-rollback-sort-inversion-bug.md`).
 *
 * `getMigrationsToRollback` reversed the executed list and then re-sorted it
 * **ascending**, which put it straight back into forward `up` order and made
 * the reverse dead code. Every rollback of a batch with more than one
 * migration ran `down()` in apply order.
 *
 * Two traps these cases are built to avoid:
 *
 * 1. The executed list is read back ordered by `batch, name` — alphabetical,
 *    NOT chronological. So "just remove the sort and keep the reverse" is also
 *    wrong, and a fixture whose names happen to sort the same way as its dates
 *    would pass under that wrong fix. Every fixture below therefore has names
 *    that are **reverse-alphabetical to their chronological order**.
 * 2. Rollback order must be the exact inverse of apply order, so each case is
 *    asserted against both comparators.
 */

const CATEGORY = { createdAt: "08-08-2026_10-00-00", migrationName: "z-category" };
const NEWS = { createdAt: "08-08-2026_10-00-10", migrationName: "m-news" };
const ADD_SUMMARY = { createdAt: "08-08-2026_11-00-00", migrationName: "a-add-summary-to-news" };

/** The order the executed table hands them back: batch, then name. */
const asStoredByName = [ADD_SUMMARY, NEWS, CATEGORY];

const order = (list: typeof asStoredByName, comparator: typeof sortMigrations) =>
  [...list].sort(comparator).map((entry) => entry.migrationName);

describe("sortMigrations — apply order", () => {
  it("orders oldest first, ignoring the alphabetical order of names", () => {
    expect(order(asStoredByName, sortMigrations)).toEqual([
      "z-category",
      "m-news",
      "a-add-summary-to-news",
    ]);
  });
});

describe("sortMigrationsForRollback — rollback order", () => {
  it("orders newest first — the reported News/Category case", () => {
    // Drop the summary column BEFORE dropping the news table that holds it.
    expect(order(asStoredByName, sortMigrationsForRollback)).toEqual([
      "a-add-summary-to-news",
      "m-news",
      "z-category",
    ]);
  });

  it("is the exact inverse of the apply order", () => {
    const applied = order(asStoredByName, sortMigrations);
    const rolledBack = order(asStoredByName, sortMigrationsForRollback);

    expect(rolledBack).toEqual([...applied].reverse());
  });

  it("is not fooled by the input already being in apply order", () => {
    const inApplyOrder = [CATEGORY, NEWS, ADD_SUMMARY];

    expect(order(inApplyOrder, sortMigrationsForRollback)).toEqual([
      "a-add-summary-to-news",
      "m-news",
      "z-category",
    ]);
  });

  it("falls back to reverse-alphabetical when timestamps cannot decide", () => {
    const undated = [
      { migrationName: "a-first" },
      { migrationName: "b-second" },
    ];

    expect(order(undated as never, sortMigrationsForRollback)).toEqual(["b-second", "a-first"]);
  });

  it("handles a two-migration batch, the smallest case that can go wrong", () => {
    // One migration has no order to get wrong — which is exactly why the
    // single-migration batch hid this bug in the original testing.
    const pair = [
      { createdAt: "08-08-2026_10-00-00", migrationName: "z-created-first" },
      { createdAt: "08-08-2026_11-00-00", migrationName: "a-created-second" },
    ];

    expect(order(pair, sortMigrationsForRollback)).toEqual(["a-created-second", "z-created-first"]);
  });
});
