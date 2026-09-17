import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, getJsonFileAsync, putFileAsync } from "@warlock.js/fs";
import type { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import { insertQueueDashboardBlock } from "./shared/insert-queue-dashboard-block";
import type { FeatureDefinition } from "./types";

/** The parts of `package.json` this feature reads to check for its prerequisite. */
type ProjectPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Fail loudly instead of installing quietly onto a project that has never
 * had `@warlock.js/queue` added.
 *
 * Deliberately NOT a `requires: ["queue"]` entry: that mechanism (see
 * `add-command.action.ts > resolveFeatures`) auto-runs the required feature,
 * which for queue means generating a Redis config and registering a
 * connector as a silent side effect of asking for a dashboard. Queue's own
 * setup is significant enough that the user should run it — and see its own
 * output — themselves.
 */
async function isQueueInstalled(): Promise<boolean> {
  const packageJson = await getJsonFileAsync<ProjectPackageJson>(rootPath("package.json"));

  return Boolean(
    packageJson.dependencies?.["@warlock.js/queue"] ||
      packageJson.devDependencies?.["@warlock.js/queue"],
  );
}

/** Insert the `dashboard` block into `src/config/queue.ts`, without reformatting it. */
async function addDashboardConfigBlock(): Promise<void> {
  const configPath = srcPath("config/queue.ts");

  if (!(await fileExistsAsync(configPath))) {
    console.log(
      `${colors.yellowBright("src/config/queue.ts")} not found — add this to your queue config yourself:\n` +
        '  dashboard: { enabled: true, path: "/admin/queues", middleware: [] },\n',
    );

    return;
  }

  const current = await getFileAsync(configPath);
  const insertion = insertQueueDashboardBlock(current);

  if (insertion.status === "already-present") {
    console.log(
      `${colors.yellowBright("dashboard")} config already present in src/config/queue.ts, skipping...`,
    );

    return;
  }

  if (insertion.status === "unrecognised") {
    console.log(
      `${colors.yellowBright("!")} src/config/queue.ts has no recognisable ${colors.yellowBright("queueConfig")} object — ` +
        "add the dashboard block yourself:\n" +
        '  dashboard: { enabled: true, path: "/admin/queues", middleware: [] },\n',
    );

    return;
  }

  await putFileAsync(configPath, insertion.next);
  console.log(`${colors.green("✓")} Added dashboard config to src/config/queue.ts`);
}

/**
 * Wire the dashboard into the app: verify queue is installed, then add the
 * `dashboard` block to its config.
 */
async function completeBullBoardInstallation(_options: CommandActionData): Promise<void> {
  if (!(await isQueueInstalled())) {
    console.log(
      `${colors.redBright("✗")} @warlock.js/queue is not installed — run ` +
        `${colors.yellowBright("warlock add queue")} first, then ${colors.yellowBright("warlock add bull-board")}.`,
    );
    process.exitCode = 1;

    return;
  }

  await addDashboardConfigBlock();

  console.log(
    "\nNext: guard the dashboard with a middleware before it ships to production — an empty " +
      "middleware list throws QueueDashboardUnguardedError at boot when NODE_ENV is \"production\".",
  );
}

/** `warlock add bull-board` — a config-driven bull-board dashboard for @warlock.js/queue. */
export const bullBoardFeature: FeatureDefinition = {
  description:
    "Installs @bull-board/api and @bull-board/fastify and adds a dashboard block to src/config/queue.ts. Requires @warlock.js/queue — run `warlock add queue` first.",
  dependencies: {
    "@bull-board/api": "^9.10.1",
    "@bull-board/fastify": "^9.10.1",
  },
  onExecuting: completeBullBoardInstallation,
};
