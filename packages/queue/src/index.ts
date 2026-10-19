/**
 * `@warlock.js/queue` — background jobs on BullMQ, local SQLite, or memory.
 */
export * from "./config";
export * from "./dashboard";
export { DEFAULT_DASHBOARD_PATH, mountQueueDashboard } from "./dashboard-boot";
export { defineJob } from "./define-job";
export {
  getDispatchInterceptor,
  setDispatchInterceptor,
  type DispatchInterceptor,
} from "./dispatch-interceptor";
export { toMilliseconds } from "./duration";
export * from "./errors";
export * from "./failed-jobs";
export { queueOf, registeredJobs, type RegisteredJob } from "./job-registry";
export * from "./queue-connector";
export {
  defineQueueContext,
  getQueueContext,
  resetQueueContext,
  setQueueContext,
  type QueueContext,
} from "./queue-context";
export { QueueDashboardUnguardedError } from "./queue-dashboard-unguarded.error";
export {
  closeQueue,
  getQueue,
  runningWorkers,
  startWorkers,
  type CloseQueueOptions,
} from "./queue-manager";
export * from "./types";
export { getQueueDriver } from "./queue-driver";
export type { DriverDispatch, QueueDriver } from "./driver";
