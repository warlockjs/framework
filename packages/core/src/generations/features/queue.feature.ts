import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import { rootPath } from "../../utils";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

const queueConfigStub = `import { env } from "@warlock.js/core";
import type { QueueConfig } from "@warlock.js/queue";

/** Durable job queue configuration. Redis is required by BullMQ. */
const queueConfig: QueueConfig = {
  connection: {
    host: env("REDIS_HOST", "127.0.0.1"),
    port: env("REDIS_PORT", 6379),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  },
  workers: {
    enabled: true,
    concurrency: 5,
    shutdownTimeout: 30_000,
  },
};

export default queueConfig;
`;

/** Register the queue connector in the app-owned configuration without reformatting it. */
async function registerQueueConnector(): Promise<void> {
  const configPath = rootPath("warlock.config.ts");

  if (!(await fileExistsAsync(configPath))) {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} not found — add this yourself:\n` +
        `  import { queueConnector } from "@warlock.js/queue";\n` +
        `  export default defineConfig({ connectors: [queueConnector()] });`,
    );

    return;
  }

  const current = await getFileAsync(configPath);

  if (current.includes("queueConnector")) {
    console.log(`${colors.yellowBright("queueConnector")} already registered, skipping...`);

    return;
  }

  const importLine = 'import { queueConnector } from "@warlock.js/queue";';
  let next = current.includes(importLine) ? current : `${importLine}\n${current}`;

  if (/connectors:\s*\[/.test(next)) {
    next = next.replace(/connectors:\s*\[/, "connectors: [queueConnector(),");
  } else if (next.includes("defineConfig({")) {
    next = next.replace("defineConfig({", "defineConfig({\n  connectors: [queueConnector()],\n");
  } else {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} has no recognisable defineConfig({...}) — ` +
        "add `connectors: [queueConnector()]` yourself.",
    );

    return;
  }

  await putFileAsync(configPath, next);
  console.log(`${colors.green("✓")} Registered queueConnector in warlock.config.ts`);
  console.log(
    "Next: start Redis, then define jobs with defineJob() in an application module before boot.",
  );
}

/** `warlock add queue` — durable BullMQ jobs backed by the app's Redis server. */
export const queueFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/queue — durable BullMQ jobs backed by Redis. Creates src/config/queue.ts and registers queueConnector() in warlock.config.ts.",
  dependencies: {
    "@warlock.js/queue": INSTALLED_WARLOCK_VERSION,
  },
  ejectConfig: {
    content: queueConfigStub,
    name: "queue",
  },
  onExecuting: registerQueueConnector,
};
