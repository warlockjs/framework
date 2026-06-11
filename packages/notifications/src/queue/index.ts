// Async queue backend (Phase 2). Herald-backed `QueueDispatcher` + the worker
// that consumes its jobs. Both lazy-import `@warlock.js/herald` (optional peer).
export * from "./herald-queue";
export * from "./notifications-worker";
export { DEFAULT_QUEUE_CHANNEL } from "./load-herald";
