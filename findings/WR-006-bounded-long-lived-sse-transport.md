# WR-006: Bounded long-lived SSE transport

Package: `@warlock.js/core` 5.29.0; Node 22.13.0.

Source-inspected behavior: `esm/http/response.mjs`, around lines 487–537,
initializes an `events` array for each `Response.sse()` stream, appends every
event with its data, and assigns the entire array to `currentBody` and
`parsedBody` when the stream ends. `send()` ignores the return value of
`raw.write()` and returns the fluent controller, so callers receive no writable
drain acknowledgment. These are confirmed source facts, not a measured production
memory failure or a demonstrated secret leak.

Request: a supported non-retaining or explicitly bounded SSE mode, stream-safe
response logging, and an asynchronous writable backpressure primitive with
disconnect/cancellation handling. A long-lived terminal should not need to retain
its complete output history to stream new output.

Owned actual HTTP evidence: one loopback request sends 1,024 events with 8,192
payload bytes each. After `end()`, `response.body` retains all 1,024 events and
8,388,608 payload bytes. Native `write()` returns false 1,017 times while sends
continue; native `writableLength` reaches 8,445,106 bytes before completion. The
client receives 8,436,650 bytes. These are retained payload/queued-byte counts,
not heap measurements, an OOM or a production incident.

Reproduce from a fresh process with `node scripts/reproduce-core-sse-retention.mjs`.
The committed runner starts one isolated ephemeral loopback server, uses
synthetic data, writes its result under an owned temporary directory and closes
its server. It loads no Bureau registry, accounts or provider. Primary reran the
same probe independently against the installed lockfile.

Application work in progress: the terminal lane uses an owned raw SSE adapter
with bounded queues/backpressure instead of the retaining controller. Native
terminal HTTP qualification has passed, while final merged stream/lifecycle/UI
acceptance remains pending. Keep this classified as a bounded-streaming
performance/feature request; no production failure or secret leak is claimed.

Evidence: author `/tmp/bureau-2-core-sse-repro-Dhe1XI/summary.json`; independent
primary receipt `.tmp/coordinator/stage13/core-sse-repro.log`; committed runner
and installed source above.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
