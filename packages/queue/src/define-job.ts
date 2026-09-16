import type { Job, JobsOptions } from "bullmq";
import { getQueueConfig } from "./config";
import { toMilliseconds } from "./duration";
import { InvalidJobDefinitionError } from "./errors";
import { queueOf, registerJob, type RegisteredJob } from "./job-registry";
import { getQueue } from "./queue-manager";
import type {
  DispatchOptions,
  JobBackoff,
  JobDefinition,
  JobOptions,
  JobSnapshot,
  JobState,
  QueueJob,
} from "./types";

/**
 * Define a background job.
 *
 * The definition is registered by name so any worker in the process can run
 * it; the returned object dispatches it with a typed payload.
 *
 * @example
 * export const sendInvoice = defineJob({
 *   name: "invoices.send",
 *   attempts: 5,
 *   backoff: { type: "exponential", delay: 2000 },
 *   async handle(payload: { invoiceId: string }, ctx) {
 *     await ctx.progress(50);
 *   },
 * });
 *
 * await sendInvoice.dispatch({ invoiceId: "42" }, { delay: "10m", priority: 1 });
 */
export function defineJob<TPayload, TResult = unknown>(
  definition: JobDefinition<TPayload, TResult>,
): QueueJob<TPayload, TResult> {
  assertValidDefinition(definition);
  registerJob(definition as RegisteredJob);

  return {
    name: definition.name,
    get queue() {
      return queueOf(definition);
    },
    async dispatch(payload, options = {}) {
      const queueName = queueOf(definition);
      const job = await getQueue(queueName).add(
        definition.name,
        payload,
        toBullJobOptions(definition, options),
      );

      return { id: String(job.id), name: definition.name, queue: queueName };
    },
    async find(id) {
      const job = await getQueue(queueOf(definition)).getJob(id);

      if (!job || job.name !== definition.name) {
        return undefined;
      }

      return toSnapshot<TPayload, TResult>(job);
    },
  };
}

function assertValidDefinition(definition: JobDefinition<unknown, unknown>): void {
  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    throw new InvalidJobDefinitionError("defineJob() requires a non-empty `name`.");
  }

  if (typeof definition.handle !== "function") {
    throw new InvalidJobDefinitionError(
      `defineJob("${definition.name}") requires a \`handle(payload, ctx)\` function.`,
    );
  }

  if (definition.attempts !== undefined && !(Number.isInteger(definition.attempts) && definition.attempts >= 1)) {
    throw new InvalidJobDefinitionError(
      `defineJob("${definition.name}"): \`attempts\` must be an integer >= 1, got ${definition.attempts}.`,
    );
  }
}

/**
 * Merge app defaults < job definition < dispatch options into BullMQ's shape.
 */
function toBullJobOptions(definition: JobOptions, options: DispatchOptions): JobsOptions {
  const defaults = getQueueConfig().defaultJobOptions ?? {};
  const attempts = options.attempts ?? definition.attempts ?? defaults.attempts;
  const backoff = options.backoff ?? definition.backoff ?? defaults.backoff;
  const removeOnComplete = definition.removeOnComplete ?? defaults.removeOnComplete;
  const removeOnFail = definition.removeOnFail ?? defaults.removeOnFail;

  const bullOptions: JobsOptions = {};

  if (attempts !== undefined) bullOptions.attempts = attempts;
  if (backoff !== undefined) bullOptions.backoff = toBullBackoff(backoff);
  if (removeOnComplete !== undefined) bullOptions.removeOnComplete = removeOnComplete;
  if (removeOnFail !== undefined) bullOptions.removeOnFail = removeOnFail;
  if (options.delay !== undefined) bullOptions.delay = toMilliseconds(options.delay);
  if (options.priority !== undefined) bullOptions.priority = options.priority;
  if (options.jobId !== undefined) bullOptions.jobId = options.jobId;

  return bullOptions;
}

function toBullBackoff(backoff: JobBackoff): JobsOptions["backoff"] {
  return typeof backoff === "number" ? { type: "fixed", delay: backoff } : backoff;
}

/**
 * A plain view of a BullMQ job.
 */
export async function toSnapshot<TPayload, TResult>(
  job: Job,
): Promise<JobSnapshot<TPayload, TResult>> {
  const state = (await job.getState()) as JobState;

  return {
    id: String(job.id),
    name: job.name,
    queue: job.queueName,
    state,
    payload: job.data as TPayload,
    progress: job.progress as JobSnapshot["progress"],
    attemptsMade: job.attemptsMade,
    result: job.returnvalue as TResult | undefined,
    failedReason: job.failedReason || undefined,
    createdAt: new Date(job.timestamp),
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
  };
}
