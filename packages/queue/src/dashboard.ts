import { defaultQueueName } from "./config";
import { QueueDashboardDependencyError } from "./errors";
import { queueOf, registeredJobs } from "./job-registry";
import { getQueue } from "./queue-manager";

/**
 * The part of a Fastify instance the dashboard needs. Warlock's HTTP server
 * (`getHttpServer()` from `@warlock.js/core`) satisfies it.
 */
export type DashboardServer = {
  register(plugin: never, options: { prefix: string }): unknown;
};

export type QueueDashboardOptions = {
  /** URL prefix the dashboard is mounted on. Default `"/admin/queues"`. */
  basePath?: string;
  /** Queues to show. Default: every queue with a defined job, plus the default queue. */
  queues?: string[];
};

type BullBoardModules = {
  createBullBoard: (options: { queues: unknown[]; serverAdapter: unknown }) => unknown;
  BullMQAdapter: new (queue: unknown) => unknown;
  FastifyAdapter: new () => {
    setBasePath(path: string): unknown;
    registerPlugin(): unknown;
  };
};

/**
 * Mount the bull-board failed/active/delayed job UI on Warlock's Fastify
 * server. Requires the optional packages `@bull-board/api` and
 * `@bull-board/fastify`; they are loaded only when this is called, and a
 * missing one throws {@link QueueDashboardDependencyError}.
 *
 * Call it before the HTTP server starts listening, and put it behind your
 * own authentication — the dashboard can retry and delete jobs.
 *
 * @example
 * import { getHttpServer } from "@warlock.js/core";
 * await queueDashboard(getHttpServer(), { basePath: "/admin/queues" });
 */
export async function queueDashboard(
  server: DashboardServer,
  options: QueueDashboardOptions = {},
): Promise<void> {
  const basePath = options.basePath ?? "/admin/queues";
  const { createBullBoard, BullMQAdapter, FastifyAdapter } = await loadBullBoard();
  const queueNames =
    options.queues ?? [...new Set([defaultQueueName(), ...registeredJobs().map((job) => queueOf(job))])];

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(basePath);

  createBullBoard({
    queues: queueNames.map((name) => new BullMQAdapter(getQueue(name))),
    serverAdapter,
  });

  await server.register(serverAdapter.registerPlugin() as never, { prefix: basePath });
}

/**
 * Load the optional bull-board packages. Exported for tests of the missing
 * dependency path; `importer` defaults to a real dynamic import.
 */
export async function loadBullBoard(
  importer: (specifier: string) => Promise<Record<string, unknown>> = (specifier) => import(specifier),
): Promise<BullBoardModules> {
  const api = await importOptional(importer, "@bull-board/api");
  const adapter = await importOptional(importer, "@bull-board/api/bullMQAdapter");
  const fastify = await importOptional(importer, "@bull-board/fastify");

  return {
    createBullBoard: api.createBullBoard as BullBoardModules["createBullBoard"],
    BullMQAdapter: adapter.BullMQAdapter as BullBoardModules["BullMQAdapter"],
    FastifyAdapter: fastify.FastifyAdapter as BullBoardModules["FastifyAdapter"],
  };
}

async function importOptional(
  importer: (specifier: string) => Promise<Record<string, unknown>>,
  specifier: string,
): Promise<Record<string, unknown>> {
  try {
    return await importer(specifier);
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new QueueDashboardDependencyError(specifier.split("/").slice(0, 2).join("/"));
    }

    throw error;
  }
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;

  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}
