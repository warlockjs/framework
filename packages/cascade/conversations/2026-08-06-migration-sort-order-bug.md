---
session: 2ec1b549-dbd4-452c-a84e-1fdef8773ae5
date: 2026-08-06
topic: "@warlock.js/cascade — SQLGrammar.sort ordered migrations alphabetically, not chronologically"
status: fixed, awaiting review
---

# Cascade migration sort-order bug

Source report: `@warlock.js/plans/2026-08-05-cascade-migration-sort-order-bug.md` (from TeamsUp,
found by @Vault, verified by @Indigo against the installed `esm/` build).

## Verification — the report is correct

Checked against **source**, not the built `esm/` the report was written from:

- `src/migration/sql-grammar.ts:145` used `new Date(a.createdAt).getTime()`.
- `new Date('08-04-2026_18-12-00').getTime()` → `NaN`, confirmed on Node v24.14.1.
- The `isNaN` guards floored both sides to `0`, so `dateA !== dateB` was never true and
  `localeCompare` on the migration name decided every comparison.
- `parseCreatedAt` existed in `migration-runner.ts:46`, was correct, and was not exported.

### Two things the report understated

1. **The buggy comparator runs LAST and overrides the correct one.** `sortMigrations`
   (`migration-runner.ts:1012,1032`) orders the migration list correctly, then
   `SQLGrammar.sort` (`migration-runner.ts:430`) re-sorts **every statement globally** across all
   pending migrations immediately before execution. So it isn't "two comparators disagree" — the
   wrong one wins by running second and discarding the right one's work.
2. **A second failure mode with mixed timestamp formats.** An ISO `createdAt` parses fine while a
   generator stamp floors to `0`, so *every* generator-stamped migration sorted ahead of *every*
   ISO-stamped one regardless of actual date. The report only covered the all-generator case.

Also confirmed the framework generates the format it couldn't parse:
`core/src/generations/add-command.action.ts:310` stamps `MM-DD-YYYY_HH-MM-SS` filenames with the
comment "so cascade infers their createdAt and orders them deterministically".

## Fix

- **New** `src/migration/parse-created-at.ts` — hoists `parseCreatedAt` (unchanged logic) and adds
  `compareCreatedAt(a, b)`, which returns `undefined` when the timestamps don't settle it so each
  caller keeps its own tiebreaker.
- `sql-grammar.ts` and `migration-runner.ts` both go through `compareCreatedAt`. The duplicate
  parser in `migration-runner.ts` is gone (-69 lines), so the two comparators cannot drift again.

## Tests — `tests/unit/migration/sql-grammar-sort.test.ts`, 16 cases

Proven to detect the bug, not just pass: with `sql-grammar.ts` stashed back to the buggy version,
**5 ordering tests fail**; with the fix, 16/16 pass.

⚠ Two of the tests initially passed against the buggy code — the alphabetical fallback happened to
produce the right answer for the names I'd picked. Rewritten with reverse-alphabetical names so
every ordering assertion is a real detector. This is exactly the trap the plan file warned about.

## Verification

- Full cascade unit suite: **35 files, 1012 passed, 7 skipped, 0 failed**.
- `tsc --noEmit`: zero errors in the three touched files.
- Diff is clean (cascade has `core.autocrlf=true`, so the LF/CRLF warnings are normal).

## Not done

- No commit, no publish. Staged in cascade's CHANGELOG under `## 4.9.0`.
- The `MM-DD` vs `DD-MM` ambiguity heuristic is **unchanged** — out of scope per the report, now
  documented as a caveat in the skill and the docs site instead of being silently relied on.
- Integration tests (`tests/integration/postgres/migrations.test.ts`) not run — they need a live
  Postgres.
