/**
 * The queue's connector for `warlock.config.ts > connectors`.
 *
 * Deliberately a plain object with TYPE-ONLY imports from core: the config
 * file that constructs it must not drag core's runtime graph (or BullMQ) in
 * at config-load time. Core is imported lazily inside `start()`, where the
 * app has already loaded it.
 */
import type { Connector, ConnectorLifecyclePhase } from "@warlock.js/core";
import { log } from "@warlock.js/logger";
import { resetQueueConfig, setQueueConfig } from "./config";
import { mountQueueDashboard } from "./dashboard-boot";
import { closeQueue, startWorkers } from "./queue-manager";
import type { QueueConfig } from "./types";

/**
 * Boots after every built-in connector (`ConnectorPriority.AI` is `10`), so
 * the logger is up and anything a job handler needs is already connected;
 * shuts down before them for the same reason.
 */
export const QUEUE_CONNECTOR_PRIORITY = 11;

const WATCHED_FILES = ["src/config/queue.ts"];

export type QueueConnectorOptions = {
  /**
   * Supply the configuration directly instead of reading the `queue` config
   * key (`src/config/queue.ts`).
   */
  config?: QueueConfig;
};

/**
 * Construct the queue connector.
 *
 * Runs in the `late` lifecycle phase — after app code is imported — so every
 * `defineJob` in the app has registered before workers start. At start it
 * reads the `queue` config and starts in-process workers unless
 * `workers.enabled` is `false`; at shutdown it closes workers (waiting for
 * active jobs, bounded by `workers.shutdownTimeout`) and then the queues.
 *
 * @example
 * // warlock.config.ts
 * import { queueConnector } from "@warlock.js/queue";
 *
 * export default defineConfig({ connectors: [queueConnector()] });
 */
export function queueConnector(options: QueueConnectorOptions = {}): Connector {
  let active = false;

  const connector: Connector = {
    name: "queue",
    priority: QUEUE_CONNECTOR_PRIORITY,
    // Core's `ConnectorLifecyclePhase.Late`; the value is spelled out so this
    // module stays free of a runtime import of core.
    lifecyclePhase: "late" as ConnectorLifecyclePhase,
    isActive: () => active,
    /**
     * Mounts the dashboard, when configured, here rather than in `start()`:
     * `boot()` runs for every late-phase connector, in priority order, before
     * any of them `start()`s — so by the time this runs, the HTTP connector
     * (priority 5, before queue's 11) has already built its Fastify instance
     * and registered its own plugins, but has not yet called `listen()`.
     * Fastify refuses new plugin registrations after `listen()`, so this is
     * the only point in the boot sequence where mounting is possible.
     */
    async boot() {
      const queueConfig = options.config ?? (await readQueueConfig());

      if (!queueConfig?.dashboard?.enabled) {
        return;
      }

      // The dashboard resolves queues through the active config, so it has to
      // be registered here rather than only in `start()`, which runs after
      // every late connector has booted. `start()` sets it again; the setter
      // is idempotent for the same object.
      setQueueConfig(queueConfig);

      const { getHttpServer } = await import("@warlock.js/core");

      await mountQueueDashboard(getHttpServer(), queueConfig);
    },
    async start() {
      const queueConfig = options.config ?? (await readQueueConfig());

      if (!queueConfig) {
        log.warn(
          "queue",
          "configured",
          "queueConnector() is registered but no `queue` config was found (src/config/queue.ts); queue not started",
        );
        return;
      }

      setQueueConfig(queueConfig);
      const started = await startWorkers();
      active = true;

      log.info(
        "queue",
        "configured",
        started.length > 0
          ? `Queue workers running for: ${started.join(", ")}`
          : "Queue configured (no in-process workers)",
      );
    },
    async restart() {
      await connector.shutdown();
      await connector.start();
    },
    async shutdown() {
      if (!active) {
        return;
      }

      await closeQueue();
      resetQueueConfig();
      active = false;
    },
    shouldRestart(changedFiles) {
      return changedFiles.some((file) => {
        const normalized = file.replace(/\\/g, "/");

        return WATCHED_FILES.some((watched) => normalized === watched || normalized.endsWith(`/${watched}`));
      });
    },
  };

  return connector;
}

async function readQueueConfig(): Promise<QueueConfig | undefined> {
  const { config } = await import("@warlock.js/core");

  return config.get<QueueConfig | undefined>("queue");
}
