/**
 * `@warlock.js/queue` — durable background jobs on BullMQ + Redis.
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
