import { randomUUID } from "node:crypto";
import type { QueueConfig } from "../src";

/**
 * Specs run against a REAL Redis. Point them at one with `QUEUE_REDIS_HOST` /
 * `QUEUE_REDIS_PORT` (default 127.0.0.1:6390). There is no skip path: an
 * unreachable server fails the run.
 */
export function testQueueConfig(overrides: Partial<QueueConfig> = {}): QueueConfig {
  return {
    connection: {
      host: process.env.QUEUE_REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.QUEUE_REDIS_PORT ?? 6390),
    },
    // A fresh prefix per call isolates each spec's keys in the shared server.
    prefix: `warlock-test-${randomUUID()}`,
    ...overrides,
  };
}

export function waitFor(predicate: () => boolean, timeout = 10_000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeout) {
        reject(new Error(`waitFor timed out after ${timeout}ms`));
        return;
      }

      setTimeout(tick, 20);
    };

    tick();
  });
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
