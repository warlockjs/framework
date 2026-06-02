# `v.date()` — method reference

`v.date()` ships a built-in mutator that normalizes strings, timestamps, and `Date` objects to a `Date` before rules run. Picking guide (`v.date()` vs `v.instanceof(Date)`) is in [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md).

## Range — global value comparison

| Method | Args | Example |
|---|---|---|
| `.min(dateOrField, msg?)` | inclusive `>=` | `v.date().min("2024-01-01")` or `v.date().min(new Date())` |
| `.max(dateOrField, msg?)` | inclusive `<=` | `v.date().max(new Date())` |
| `.before(dateOrField, msg?)` | strict `<` | `v.date().before(new Date())` |
| `.after(dateOrField, msg?)` | strict `>` | `v.date().after(new Date())` |
| `.between(start, end, msg?)` | inclusive range | `v.date().between(start, end)` |

Smart detection: a string with `-` or `/` is a date string; a plain string is a sibling field name.

## Range — explicit sibling scope

| Method | Effect |
|---|---|
| `.minSibling(field, msg?)` | `>=` sibling field |
| `.maxSibling(field, msg?)` | `<=` sibling field |
| `.beforeSibling(field, msg?)` | `<` sibling field |
| `.afterSibling(field, msg?)` | `>` sibling field |
| `.sameAsField(field, msg?)` | `===` sibling field |
| `.sameAsFieldSibling(field, msg?)` | `===` sibling field (explicit scope) |

Only run inside `v.object`. Not representable in JSON Schema.

## Today / past / future

| Method | Effect |
|---|---|
| `.today(msg?)` | exactly today |
| `.fromToday(msg?)` | today or future |
| `.beforeToday(msg?)` | strictly before today |
| `.afterToday(msg?)` | strictly after today |
| `.past(msg?)` | any past date |
| `.future(msg?)` | any future date |

## Relative window

| Method | Args | Effect |
|---|---|---|
| `.withinDays(n, msg?)` | within N days past or future | — |
| `.withinPastDays(n, msg?)` | within N days in the past | — |
| `.withinFutureDays(n, msg?)` | within N days in the future | — |

## Age

| Method | Args | Effect |
|---|---|---|
| `.age(years, msg?)` | exactly N years old |
| `.minAge(years, msg?)` | at least N years old |
| `.maxAge(years, msg?)` | at most N years old |
| `.betweenAge(min, max, msg?)` | between min/max years |
| `.birthday(minAge?, maxAge?, msg?)` | not in future, optional age range |

## Weekday / weekend / business day

| Method | Args | Effect |
|---|---|---|
| `.weekDay(day, msg?)` | day = `"monday"` … `"sunday"` |
| `.weekdays(days, msg?)` | array of weekdays |
| `.weekend(msg?)` | Saturday or Sunday |
| `.businessDay(msg?)` | Monday – Friday |

## Period — month / year / quarter

| Method | Args | Effect |
|---|---|---|
| `.month(m, msg?)` | `m` = 1–12 (or `Month` enum) |
| `.year(y, msg?)` | exact year |
| `.quarter(q, msg?)` | `q` = 1–4 |
| `.leapYear(msg?)` | year is a leap year |
| `.minYear(yearOrField, msg?)` | year `>=` |
| `.maxYear(yearOrField, msg?)` | year `<=` |
| `.minMonth(mOrField, msg?)` | month `>=` |
| `.maxMonth(mOrField, msg?)` | month `<=` |
| `.minDay(dOrField, msg?)` | day-of-month `>=` |
| `.maxDay(dOrField, msg?)` | day-of-month `<=` |
| `.betweenYears(start, end, msg?)` | inclusive year range |
| `.betweenMonths(start, end, msg?)` | inclusive month range |
| `.betweenDays(start, end, msg?)` | inclusive day-of-month range |

Each `min*` / `max*` / `between*` accepts a sibling field name. Sibling-explicit variants exist: `.minYearSibling`, `.maxYearSibling`, `.minMonthSibling`, `.maxMonthSibling`, `.minDaySibling`, `.maxDaySibling`, `.betweenYearsSibling`, `.betweenMonthsSibling`, `.betweenDaysSibling`.

## Time — hour / minute

| Method | Args | Effect |
|---|---|---|
| `.fromHour(h, msg?)` | h = 0–23, time `>= h:00` |
| `.beforeHour(h, msg?)` | time `< h:00` |
| `.betweenHours(start, end, msg?)` | inclusive hour range |
| `.fromMinute(m, msg?)` | m = 0–59 |
| `.beforeMinute(m, msg?)` | — |
| `.betweenMinutes(start, end, msg?)` | inclusive minute range |
| `.betweenTimes(start, end, msg?)` | "HH:MM" strings |

## Format

| Method | Args | Effect |
|---|---|---|
| `.format(fmt, msg?)` | dayjs format string | input must match the format |

## Mutators (pre-validation reshape)

| Method | Effect |
|---|---|
| `.toStartOfDay()` | 00:00:00.000 |
| `.toEndOfDay()` | 23:59:59.999 |
| `.toStartOfMonth()` | first day of month |
| `.toEndOfMonth()` | last day of month |
| `.toStartOfYear()` | January 1st |
| `.toEndOfYear()` | December 31st |
| `.addDays(n)` | shift by N days (negative = back) |
| `.addMonths(n)` | shift by N months |
| `.addYears(n)` | shift by N years |
| `.addHours(n)` | shift by N hours |
| `.toUTC()` | normalize to UTC |

Mutators run *before* rules. `v.date().addDays(7).future()` checks whether the shifted date is in the future.

## Transformers (post-validation, reshape `data`)

| Method | Args | Effect |
|---|---|---|
| `.toISOString()` | — | `Date` → `"2026-01-15T00:00:00.000Z"` |
| `.toTimestamp()` | — | `Date` → number (ms since epoch) |
| `.toFormat(fmt)` | dayjs format string | `Date` → formatted string |
| `.toDateOnly()` | — | `"YYYY-MM-DD"` |
| `.toTimeOnly()` | — | `"HH:mm:ss"` |

Transformers shape the *output*. `Infer<>` still resolves to `Date` even if a transformer changes the runtime shape — `Infer` reads the validator type, not the transformer pipeline.

## Defaults

| Method | Effect |
|---|---|
| `.defaultNow()` | shorthand for `.default(() => new Date())` |

## JSON Schema mapping

- `v.date()` → `{ type: "string", format: "date-time" }` by default
- After `.toDateOnly()` or `.format("YYYY-MM-DD")` → `{ type: "string", format: "date" }`
- After `.toTimeOnly()` or `.format("HH:mm:ss")` → `{ type: "string", format: "time" }`
- Sibling-scoped rules and most relative checks are not representable — silently omitted

## Common chains

```ts
// Birthday — must be 13+ and in the past
v.date().past().minAge(13)

// Reservation — future, business day, between hours
v.date().future().businessDay().betweenHours(9, 17)

// Effective date range (cross-field)
v.object({
  startsAt: v.date(),
  endsAt: v.date().afterSibling("startsAt"),
})

// API response — emit ISO string
v.date().toISOString()

// Event window — within 30 future days, normalized to UTC
v.date().toUTC().withinFutureDays(30)

// Quarterly report
v.date().quarter(1).year(2026)

// Date-only, end-of-day for inclusive comparisons
v.date().toEndOfDay().toDateOnly()
```
