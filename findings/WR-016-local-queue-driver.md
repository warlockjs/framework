# WR-016: local queue driver — file, SQLite or in-memory (target 5.34)

Date: 2026-10-19 · Package: @warlock.js/queue · From: Bureau

**Today:** `queue` needs BullMQ and Redis, which fits servers but not local or desktop apps.

**Request:** a durable SQLite or file driver, plus in-memory for tests, with the same `defineJob`/`dispatch` API,
retries, backoff and graceful shutdown.
