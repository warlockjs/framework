/**
 * `@warlock.js/queue` — durable background jobs on BullMQ + Redis.
 *
 * The notifications adapter lives on the `@warlock.js/queue/notifications`
 * subpath so this barrel never loads `@warlock.js/notifications`.
 */
export * from "./config";
export * from "./dashboard";
export { DEFAULT_DASHBOARD_PATH, mountQueueDashboard } from "./dashboard-boot";
export { defineJob } from "./define-job";
export { toMilliseconds } from "./duration";
export * from "./errors";
export * from "./failed-jobs";
export * from "./queue-connector";
export { QueueDashboardUnguardedError } from "./queue-dashboard-unguarded.error";
export { closeQueue, getQueue, runningWorkers, startWorkers, type CloseQueueOptions } from "./queue-manager";
export * from "./types";
