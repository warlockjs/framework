import { QueueNotConfiguredError } from "./errors";
import type { QueueConfig } from "./types";

let activeConfig: QueueConfig | undefined;

/**
 * Set the active queue configuration. In a Warlock app the queue connector
 * calls this at boot with `src/config/queue.ts`; scripts and tests may call
 * it directly. Replaces (does not merge) any previous configuration.
 */
export function setQueueConfig(config: QueueConfig): void {
  activeConfig = config;
}

/**
 * The active queue configuration. Throws {@link QueueNotConfiguredError}
 * when none was set.
 */
export function getQueueConfig(): QueueConfig {
  if (!activeConfig) {
    throw new QueueNotConfiguredError();
  }

  return activeConfig;
}

/** Forget the active configuration. */
export function resetQueueConfig(): void {
  activeConfig = undefined;
}

/** The queue a job runs on when it names none. */
export function defaultQueueName(): string {
  return activeConfig?.defaultQueue ?? "default";
}
