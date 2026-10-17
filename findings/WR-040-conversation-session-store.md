# WR-040 — A conversation session primitive with a file/SQLite store

- **Package:** `@warlock.js/ai` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

Multi-turn chat with one agent is caller-assembled. The host captures `report.messages`, keeps the last trip's provider `blocks` for thinking replay, persists them, reloads them as `history`, and decides what to compact. `ai.orchestrator` has sessions but is supervisor-shaped. Snapshot stores exist for memory, Postgres and Redis, but not for files or SQLite, which local-first apps need.

## Request

- `ai.session({ id, store, agent })` with `send(input, options)`. It loads the history, runs `agent.execute`/`stream`, appends the turn (including provider blocks for replay), and persists. Add `fork()` and `truncate()`.
- `ai.snapshot.file({ dir })` and `ai.snapshot.sqlite({ path })` stores (also usable for `durable` runs).
- A default compaction strategy hook (see WR-041).
