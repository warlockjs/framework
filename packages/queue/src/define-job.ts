import { getDispatchInterceptor } from "./dispatch-interceptor";
import { InvalidJobDefinitionError } from "./errors";
import { getQueueContext, wrapPayload } from "./queue-context";
import { queueOf, registerJob, type RegisteredJob } from "./job-registry";
import { getQueueDriver } from "./queue-driver";
import { resolveJobOptions } from "./job-options";
import type { JobDefinition, JobSnapshot, QueueJob } from "./types";

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
      const interceptor = getDispatchInterceptor();

      // A test fake stands in for the broker: record, never touch Redis.
      if (interceptor) {
        return interceptor.dispatch({ name: definition.name, queue: queueName, payload, options });
      }

      // Capture synchronously, in the caller's async context.
      const captured = definition.context === false ? undefined : getQueueContext()?.capture();
      return getQueueDriver().dispatch({
        name: definition.name,
        queue: queueName,
        data: wrapPayload(payload, captured),
        options: resolveJobOptions(definition, options),
      });
    },
    async find(id) {
      const interceptor = getDispatchInterceptor();

      if (interceptor) {
        const found = await interceptor.find?.({
          name: definition.name,
          queue: queueOf(definition),
          id,
        });

        return found as JobSnapshot<TPayload, TResult> | undefined;
      }

      const snapshot = await getQueueDriver().find(queueOf(definition), id);
      return snapshot?.name === definition.name
        ? (snapshot as JobSnapshot<TPayload, TResult>)
        : undefined;
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

  if (
    definition.attempts !== undefined &&
    !(Number.isInteger(definition.attempts) && definition.attempts >= 1)
  ) {
    throw new InvalidJobDefinitionError(
      `defineJob("${definition.name}"): \`attempts\` must be an integer >= 1, got ${definition.attempts}.`,
    );
  }
}
