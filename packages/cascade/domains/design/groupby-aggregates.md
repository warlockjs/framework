# Primitive spec — `groupBy(fields, aggregates)` on Postgres

**Status:** Agreed
**Last updated:** 2026-05-16
**Source of truth:** `@warlock.js/cascade/src/drivers/postgres/postgres-query-builder.ts`, `postgres-dialect.ts`, `postgres-query-parser.ts`, `expressions/aggregate-expressions.ts`
**Skill (how-to):** [`../skills/groupby-aggregates/SKILL.md`](../skills/groupby-aggregates/SKILL.md)
**Decision:** [`decisions.md` #9](./decisions.md)
**Originating plan:** `plans/2026-05-16-postgres-groupby-aggregates-parity.md` (delete on full ship)

Answers _how the two-arg `groupBy` works under the hood on Postgres_ — not how to use it (that's the skill / aggregates guide).

## The gap this closes

`groupBy(fields, aggregates)` is a two-arg overload on `QueryBuilderContract`. MongoDB implemented it; Postgres inherited only the single-arg base and silently discarded the second argument. Type-system allowed it, runtime produced category rows with no computed columns — same footgun class as the MongoDB silent-join emulation.

A second, subtler half: even with aggregates projected, `.having("total", ">", 1000)` on the aliased aggregate reached the parser and emitted `HAVING "total" > $1`. **Postgres permits SELECT aliases only in `GROUP BY` / `ORDER BY`, never in `HAVING`** — so the ergonomic having form threw `column "total" does not exist` at runtime while the same chain worked on MongoDB.

## Design — three parts

### 1. Dialect owns aggregate → SQL (`SqlDialectContract.aggregateToSql`)

`aggregateToSql(expression: AggregateExpression): string` is on the **dialect contract**, implemented by `PostgresDialect`. It is the same class of per-DB concern the dialect already owns (`quoteIdentifier`, `jsonExtract`, `likePattern`, `supportsReturning`, `upsertKeyword`). Putting it on the contract forces every future SQL dialect (MySQL) to decide its own aggregate matrix explicitly at the seam instead of copy-pasting a QB override with a divergent throw-list.

- `count` → `COUNT(*)` (`$agg.count()` is always `__field: null`).
- `sum`/`avg`/`min`/`max` → `SUM/AVG/MIN/MAX("col")`.
- `distinct`/`floor`/`first`/`last` → **throw** (fail-fast, at `.groupBy()` call time) with a message naming the `selectRaw`/`havingRaw` escape hatch. See the five-vs-four rationale below.

### 2. Postgres QB `groupBy` override + alias map

Single-arg defers to `super.groupBy(fields)`. With `aggregates`:

- Project the grouped columns explicitly (`SELECT *` is invalid alongside `GROUP BY`).
- Per entry: `$agg.*` → `dialect.aggregateToSql`; raw `string` → verbatim; anything else (a MongoDB operator object) → throw "not portable to SQL".
- Record `alias → sql` in `aggregateAliases`, push `selectRaw("<sql> AS \"alias\"")`, then `super.groupBy(fields)`.

Decompose-via-`selectRaw`-keep-parser-pure is the driver's dominant idiom (`applyJoinRelations`, `applyHasRelations`, `applyCountRelations`, `similarTo`). Zero parser case-arms added.

### 3. Parse-time HAVING rewrite (`applyGroupByAggregates`)

A pre-parse pass (mirrors `applyHasRelations`' in-place `Array.map` rewrite) called in the `get()` / `parse()` preludes after `applyCountRelations`. It rewrites every `having` op whose `field` matches a recorded aggregate alias into a `havingRaw` carrying the substituted expression (`SUM("input_tokens") > ?`, bindings `[value]`). A `having` on a grouped *column* (no alias match) is left untouched. Running at parse time (not in the override) makes it independent of fluent call order. Idempotent via `groupByAggregatesApplied`; `aggregateAliases` + the guard are copied in `clone()`.

#### `processHavingRaw` consistency fix (+ latent bug)

`processHavingRaw` previously pushed `data.expression` verbatim and **dropped `data.bindings`** — unlike its siblings `processWhereRaw` / `processSelectRaw`, which thread `?` → `addParam`. The HAVING rewrite needs parameterized output (inlining the literal would be SQL injection), so `processHavingRaw` now threads bindings the same way. This also fixes a pre-existing latent bug: `.havingRaw("x > ?", [5])` silently dropped `[5]`. Shipped in the same commit (the feature depends on it). This is the **only** parser change — a 3-line consistency fix, categorically not the `OperationType`/switch surgery a parser-side `groupByWithAggregates` op would have required.

## Five cross-driver, four MongoDB-only

| Helper | Postgres | Why |
| --- | --- | --- |
| `count`/`sum`/`avg`/`min`/`max` | ✅ ANSI SQL | clean scalar aggregates |
| `distinct` | ⛔ throw | Mongo returns the array of distinct values; SQL `DISTINCT` is a set quantifier, not a scalar aggregate — `COUNT(DISTINCT f)` would be a silently-different semantic |
| `floor` | ⛔ throw | scalar function, not an aggregate; meaningless in a bare `GROUP BY` |
| `first`/`last` | ⛔ throw | needs `FIRST_VALUE/LAST_VALUE OVER (ORDER BY …)` — a windowing context `$agg` doesn't carry |

The throw lives in `PostgresDialect.aggregateToSql` (`default:` arm). v1 covers the 95% reporting case; the four are documented MongoDB-only with the `selectRaw` escape hatch.

## Why not parser-side (Option A, rejected)

A `groupByWithAggregates` `OperationType` + parser translator mirrors MongoDB's structure but adds parser schema-awareness — architecturally deviant; the whole driver keeps the parser pure and decomposes in the QB via `apply*`. Same reasoning as [`decisions.md` #8](./decisions.md) (whereHas family translated builder-side). Rejected on consistency, not just regression risk.

## Verification

- `tests/unit/drivers/postgres/postgres-query-builder.test.ts` — 8 cases (five aggregates, multi-field, HAVING-rewrite asserts the substituted expression not the alias, non-aggregate-having passthrough, raw-string passthrough, object-aggregate throw, four MongoDB-only throws, single-arg unchanged) + a `havingRaw` bindings-threading regression. Mock-driver lane (no DB).
- Real-Postgres proof out-of-band via `src/app/examples/groupby-aggregates-demo.ts` through `yarn start`: emitted `HAVING SUM("input_tokens") > $1` (bindings `[1000]`) and executed against the live PG data source returning `[]` **without throwing** — the alias form would have thrown `column "totalInput" does not exist`. A dedicated DB-backed cascade test lane remains an optional deferred follow-up.
