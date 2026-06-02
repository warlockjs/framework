import type { ObjectValidator } from "@warlock.js/seal";
import { v } from "@warlock.js/seal";
import type {
  UseCaseBeforeMiddleware,
  UseCaseContext,
  UseCaseGuard,
  UseCaseOnExecutingContext,
} from "./types";
import { fireLifecycleEvent, globalEventsCallbacksMap } from "./use-case-events";
import { BadSchemaUseCaseError } from "./use-case.errors";

export type PipelineOptions<Input> = {
  name: string;
  id: string;
  data: Input;
  ctx: UseCaseContext;
  startedAt: Date;
  schema?: ObjectValidator;
  guards?: UseCaseGuard<Input>[];
  before?: UseCaseBeforeMiddleware<Input>[];
  /** Invocation-level onExecuting override */
  onExecuting?: (ctx: UseCaseOnExecutingContext) => void;
  /** Use-case-level onExecuting */
  ucOnExecuting?: (ctx: UseCaseOnExecutingContext) => void;
};

/**
 * Runs the pre-handler pipeline in order:
 * onExecuting event → guards → validation → before middleware.
 *
 * Returns the validated, transformed data ready for the handler. The handler is
 * invoked by the caller so retry/benchmark can wrap it in isolation — keeping
 * guards, validation, and onExecuting from re-running on each retry attempt.
 *
 * Throws on guard failure or validation failure.
 *
 * @example
 * const data = await runPipeline({ name, id, data, ctx, startedAt, schema, guards, before });
 */
export async function runPipeline<Input>(opts: PipelineOptions<Input>): Promise<Input> {
  const { name, id, ctx, startedAt, schema, guards, before, onExecuting, ucOnExecuting } = opts;
  let data = opts.data;

  await fireLifecycleEvent<UseCaseOnExecutingContext>(
    { name, id, data, schema, ctx, startedAt },
    {
      invocation: onExecuting ? [onExecuting] : undefined,
      useCase: ucOnExecuting ? [ucOnExecuting] : undefined,
      global: globalEventsCallbacksMap.onExecuting.length
        ? globalEventsCallbacksMap.onExecuting
        : undefined,
    },
  );

  if (guards) {
    for (const guard of guards) {
      await guard(Object.freeze(data) as Readonly<Input>, ctx);
    }
  }

  if (schema) {
    const result = await v.validate(schema, data);

    if (!result.isValid) {
      throw new BadSchemaUseCaseError(result);
    }

    data = result.data;
  }

  let transformed = data;

  if (before) {
    for (const middleware of before) {
      transformed = await middleware(transformed, ctx);
    }
  }

  return transformed;
}
