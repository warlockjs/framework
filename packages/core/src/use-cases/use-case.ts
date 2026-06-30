import { except, Random, retry as runWithRetry } from "@mongez/reinforcements";
import { log } from "@warlock.js/logger";
import type { Infer, ObjectValidator } from "@warlock.js/seal";
import { measure } from "../benchmark";
import { config } from "../config";
import type {
  UseCase,
  UseCaseConfigurations,
  UseCaseContext,
  UseCaseErrorResult,
  UseCaseHandler,
  UseCaseResult,
  UseCaseRuntimeOptions,
  UseCaseWithSchema,
} from "./types";
import { broadcastUseCaseResult } from "./use-case-broadcast";
import { fireLifecycleEvent, globalEventsCallbacksMap } from "./use-case-events";
import { runPipeline } from "./use-case-pipeline";
import {
  $registerUseCase,
  $unregisterUseCase,
  addUseCaseHistory,
  increaseUseCaseFailedCalls,
  increaseUseCaseSuccessCalls,
} from "./use-cases-registry";

const defaultUseCaseOptions: UseCaseConfigurations = {
  benchmark: true,
};

/**
 * Defines and registers a use case.
 *
 * A use case is a named, observable, optionally benchmarked unit of business logic.
 * The returned handler is a typed async function you call with the input data.
 *
 * Execution order: onExecuting → guards → validation → before → handler → after →
 * onCompleted → broadcast. Retry and benchmark wrap the **handler** only.
 *
 * When a `schema` is provided, the handler's input is inferred from it — no manual
 * `Input` generic needed.
 *
 * @example
 * export const createOrderUseCase = useCase({
 *   name: "create_order",
 *   schema: createOrderSchema,           // handler `data` is inferred from this
 *   guards: [authGuard],
 *   handler: async (data, ctx) => orderService.create(data),
 *   after: [sendConfirmationEmail],
 *   retry: { attempts: 3, delay: 500, backoff: "exponential" },
 *   broadcast: true,
 * });
 *
 * // In a controller:
 * const output = await createOrderUseCase({ ...validated, user_id: req.user.id });
 */
export function useCase<
  Output,
  Schema extends ObjectValidator,
  Ctx extends UseCaseContext = UseCaseContext,
>(options: UseCaseWithSchema<Output, Schema, Ctx>): UseCaseHandler<Output, Infer<Schema>>;
export function useCase<Output = any, Input = any, Ctx extends UseCaseContext = UseCaseContext>(
  options: UseCase<Output, Input, Ctx>,
): UseCaseHandler<Output, Input>;
export function useCase<Output = any, Input = any>(
  options: UseCase<Output, Input>,
): UseCaseHandler<Output, Input> {
  const { name, handler, schema, guards, before, after, onExecuting, onCompleted, onError } =
    options;

  // Merge per-use-case options with global config defaults
  const useCaseConfig = config.get<UseCaseConfigurations>("use-cases", defaultUseCaseOptions);
  const benchmark = options.benchmark ?? useCaseConfig?.benchmark ?? true;
  const retryConfig = options.retry ?? useCaseConfig?.retry;
  const broadcast = options.broadcast;
  const broadcastConfig = useCaseConfig?.broadcast;
  const logEnabled = useCaseConfig?.log === true;

  $registerUseCase(name, {
    ...options,
    calls: { success: 0, failed: 0, total: 0 },
  });

  const useCaseHandler = async (
    data: Input,
    {
      ctx = {},
      id = `uc-${name}-` + Random.string(),
      onExecuting: invocationOnExecuting,
      onCompleted: invocationOnCompleted,
      onError: invocationOnError,
    }: UseCaseRuntimeOptions = {},
  ): Promise<Output> => {
    ctx.schema = schema;
    ctx.id = id;

    const startedAt = new Date();
    let output: Output | undefined;
    let error: Error | undefined;
    let benchmarkResult: { latency: number; state: "excellent" | "good" | "poor" } | undefined;
    // 1-based count of failed attempts (reinforcements' `attempt` arg). Translated
    // into "retries performed" at snapshot time — see the `currentRetry` derivation.
    let failedAttempts = 0;

    if (logEnabled) {
      log.debug("use-cases", name, "executing", { id });
    }

    try {
      const transformed = await runPipeline<Input>({
        name,
        id,
        data,
        ctx,
        startedAt,
        schema,
        guards,
        before,
        onExecuting: invocationOnExecuting,
        ucOnExecuting: onExecuting,
      });

      // Benchmark wraps ONLY the handler (per attempt) so latency reflects business
      // logic — not the guard/validation prelude, and not the retry backoff delays.
      const runHandler = async (): Promise<Output> => {
        if (!benchmark) {
          return handler(transformed, ctx);
        }

        const measured = await measure(
          name,
          () => handler(transformed, ctx),
          benchmark === true ? undefined : benchmark,
        );

        benchmarkResult = { latency: measured.latency, state: measured.state };

        // measure() never throws — it returns an error result. Re-throw so retry
        // and the outer catch handle failures uniformly.
        if (!measured.success) {
          throw measured.error;
        }

        return measured.value;
      };

      output = retryConfig
        ? await runWithRetry(runHandler, {
            ...retryConfig,
            onError: (retryError, attempt) => {
              failedAttempts = attempt;
              retryConfig.onError?.(retryError, attempt);
            },
          })
        : await runHandler();
    } catch (err) {
      error = err as Error;
    }

    const endedAt = new Date();

    // After middleware — fire-and-forget side effects, only on success.
    // Keyed off the error flag alone so void handlers (which return undefined)
    // still run their after middleware.
    if (!error && after) {
      for (const middleware of after) {
        try {
          // On the success path `output` holds the handler's return value; for a
          // void handler that's undefined, which the middleware receives as-is.
          await middleware(output as Output, ctx);
        } catch (afterError) {
          log.error("use-cases", name, "after middleware failed", { error: afterError });
        }
      }
    }

    // Retries actually performed (0 = succeeded on the first try). On success every
    // failed attempt was followed by a retry; on failure the final failed attempt
    // was NOT retried, so it doesn't count as a retry performed.
    const currentRetry = error ? Math.max(failedAttempts - 1, 0) : failedAttempts;

    const snapshot: UseCaseResult<Output> = {
      output,
      ctx,
      startedAt,
      endedAt,
      id,
      name,
      retries: retryConfig
        ? { attempts: retryConfig.attempts ?? 3, delay: retryConfig.delay, currentRetry }
        : undefined,
      benchmarkResult,
      // Set per-branch below so the counter reflects the actual outcome —
      // a failure must never increment the success tally.
      calls: 0,
    };

    if (error) {
      snapshot.calls = increaseUseCaseFailedCalls(name);

      if (logEnabled) {
        log.error("use-cases", name, "failed", { id, error });
      }

      await fireLifecycleEvent<UseCaseErrorResult>(
        { ...except(snapshot, ["output"]), error },
        {
          invocation: invocationOnError ? [invocationOnError] : undefined,
          useCase: onError ? [onError] : undefined,
          global: globalEventsCallbacksMap.onError.length
            ? globalEventsCallbacksMap.onError
            : undefined,
        },
      );

      throw error;
    }

    snapshot.calls = increaseUseCaseSuccessCalls(name);

    if (logEnabled) {
      log.debug("use-cases", name, "completed", { id, latency: benchmarkResult?.latency });
    }

    // History is best-effort — a cache rejection must not turn a successful run
    // into a thrown error or skip onCompleted/broadcast.
    try {
      await addUseCaseHistory(name, snapshot);
    } catch (historyError) {
      log.error("use-cases", name, "history persistence failed", { id, error: historyError });
    }

    await fireLifecycleEvent<UseCaseResult<Output>>(snapshot, {
      invocation: invocationOnCompleted ? [invocationOnCompleted] : undefined,
      useCase: onCompleted ? [onCompleted] : undefined,
      global: globalEventsCallbacksMap.onCompleted.length
        ? globalEventsCallbacksMap.onCompleted
        : undefined,
    });

    await broadcastUseCaseResult({
      name,
      id,
      // A void handler resolves to undefined — broadcast it as-is rather than
      // asserting a non-null value that would fabricate a bogus payload.
      output: output as Output,
      result: snapshot,
      broadcast,
      config: broadcastConfig,
    });

    return output as Output;
  };

  useCaseHandler.$cleanup = () => {
    $unregisterUseCase(name);
  };

  return useCaseHandler;
}
