import { getQueueConfig } from "./config";
import type { QueueDriver } from "./driver";
import { BullMQDriver } from "./drivers/bullmq";
import { LocalDriver } from "./drivers/local";
import { MemoryStore } from "./drivers/memory-store";
import { SqliteStore } from "./drivers/sqlite-store";

let activeDriver: QueueDriver | undefined;

/** The configured backend, created on first use. Close it before changing config. */
export function getQueueDriver(): QueueDriver {
  if (!activeDriver) {
    const config = getQueueConfig();
    switch (config.driver ?? "bullmq") {
      case "bullmq":
        activeDriver = new BullMQDriver(config);
        break;
      case "local":
        activeDriver = new LocalDriver(new SqliteStore(config), config);
        break;
      case "memory":
        activeDriver = new LocalDriver(new MemoryStore(), config);
        break;
      default:
        throw new Error(`Unknown queue driver: ${String(config.driver)}`);
    }
  }
  return activeDriver;
}

export function currentQueueDriver(): QueueDriver | undefined {
  return activeDriver;
}

export function forgetQueueDriver(): void {
  activeDriver = undefined;
}
