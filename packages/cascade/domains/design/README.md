# domains/cascade/design/

**Internal** design artifacts — how `@warlock.js/cascade` works under the hood, decisions made and why, primitive specs.

Answers _"How does it work?"_ — not _"How do I use it?"_ (that's [`../docs/`](../docs/)).

## Contents

- [`decisions.md`](./decisions.md) — **locked** architectural decisions, append-only newest-first
- [`groupby-aggregates.md`](./groupby-aggregates.md) — primitive spec: Postgres two-arg `groupBy(fields, aggregates)` (dialect-owned aggregate→SQL, parse-time HAVING rewrite)

## Rules

- **Decisions** are append-only — new entries on top, old ones never rewritten in place (correct via new entry)
- **Open questions** belong in `open-questions.md` once that file exists; promote to `decisions.md` when locked
- **Primitive specs** (e.g. `relations.md`, `query-builder.md`) are living documents — updated in place as the design evolves, with a `Last updated` date at the top
