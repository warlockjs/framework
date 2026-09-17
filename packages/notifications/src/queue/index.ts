// Async queue backend (Phase 2). Herald-backed `QueueDispatcher` + the worker
// that consumes its jobs. Both lazy-import `@warlock.js/herald` (optional peer).
export * from "./herald-queue";
export * from "./notifications-worker";
export { DEFAULT_QUEUE_CHANNEL } from "./load-herald";

// BullMQ-backed `QueueDispatcher` — an alternative to `heraldQueue()` for apps
// that already run `@warlock.js/queue`. Lazy-imports `@warlock.js/queue`
// (optional peer) — see `load-queue.ts`.
export * from "./bullmq-queue";
export { loadQueuePackage, type QueuePackageLoader } from "./load-queue";
export { QueuePackageNotInstalledError } from "./queue-package-not-installed.error";
