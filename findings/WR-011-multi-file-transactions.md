# WR-011: multi-file transactions on @warlock.js/fs (target 5.35)

Date: 2026-10-19 · Package: @warlock.js/fs (or a new @warlock.js/state) · From: Bureau

**Today:** `fs` has atomic single-file writes and a cooperating-writers claim. Bureau built its own workspace
writer on top. It has:
- multi-file mutations in one unit;
- compare-and-swap on a revision or epoch;
- an intent and recovery journal (held, inspect, complete or roll back);
- idempotency and replay keys;
- a bounded retry for reads that race a writer.

Most of Bureau's persistence bugs lived in this layer.

**Request:** `fs.transaction(root, async (tx) => …)` with read-your-writes, CAS preconditions, a durable journal
with crash recovery, an operation id for idempotent replay, and `fs.read(..., { consistent: true })` with a retry on
snapshot change. Design it once, carefully; Bureau's `app/workspaces` writer is the reference implementation.
