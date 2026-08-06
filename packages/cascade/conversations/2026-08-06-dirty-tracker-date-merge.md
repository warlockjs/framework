---
session: 2ec1b549-dbd4-452c-a84e-1fdef8773ae5
date: 2026-08-06
topic: "@warlock.js/cascade — mergeIntoRaw silently discarded a Date merged over a Date"
status: fixed, staged as 4.9.1, working-tree only
---

# Dirty-tracker Date-merge bug

Source report: `@warlock.js/plans/2026-08-06-cascade-dirty-tracker-date-merge-bug.md`
(TeamsUp; @Girder runtime, @Quill source, @Indigo build confirmation).

## Verification — report is correct

Checked against source, plus empirically:

- `src/database-dirty-tracker.ts:364` guarded on `typeof value === "object"` with no
  plain-object check.
- `Object.entries(new Date())` → `[]`, `typeof` → `"object"`, `Array.isArray` → `false`.
  So Date-over-Date passed the guard, recursed, copied nothing, kept the old value.
- `isPlainObject` was **already imported at line 2** and already used by `canBeFlatten`
  (line 5) — the fix was one guard away the whole time, exactly as the report said.
- `isPlainObject` verified: `false` for Date / Map / Set / array / null, `true` for `{}`.
- `clone()` from `@mongez/reinforcements` preserves `Date` instances, so the replace
  branch is safe.

## Fix

`mergeIntoRaw` now recurses only when BOTH sides are plain objects; everything else
replaces. This also drops the redundant `!Array.isArray` checks (`isPlainObject`
already excludes arrays) and brings the tracker in line with `mergeTwo`, which
`model.data` uses — the two disagreeing was the deeper defect.

## Tests — `tests/unit/dirty-tracker-object-values.test.ts`, 10 cases

**Proven detectors: 6 fail against the unfixed tracker**, 10/10 pass with the fix.
Every case starts from an already-populated column, because the first write into an
empty column always worked — that asymmetry is what made the bug look like a test
artifact.

⚠ My first draft had 3 failures caused by *my own wrong assumption*, not the bug:
`getDirtyColumnsWithValues()` returns a flattened `{ "a.b": { oldValue, newValue } }`
diff, not merged data. Rewritten against the real API.

## Verification

- Full cascade unit suite: **36 files, 1022 passed, 7 skipped, 0 failed**.
- `tsc --noEmit`: clean for both touched files.
- `skills/track-changes` gained a "How a merge decides what changed" section + a 4.9.1
  note; `llms.txt` / `llms-full.txt` regenerated.

## Not done

- **Not committed, not published.** Staged under `## 4.9.1` in cascade's CHANGELOG.
  4.9.0 went out earlier today, so this needs its own patch release.
- Docs-site page not touched — the merge semantics live in the skill; consider whether
  `the-basics` needs the same note before shipping 4.9.1.
- The report's secondary observation is **unaddressed by design**: `save()` returning
  `{ success: true, modifiedCount: 0 }` gives callers no way to tell "nothing needed
  changing" from "the change was lost". That is an API decision, not a bug fix.
