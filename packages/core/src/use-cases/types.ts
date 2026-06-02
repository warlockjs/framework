import type { RetryOptions } from "@mongez/reinforcements";
import { type Infer, type ObjectValidator } from "@warlock.js/seal";
import { BenchmarkOptions } from "../benchmark";

/**
 * Shared context object passed through the entire use case pipeline.
 * Contains the optional schema and can be enriched by guards/middleware
 * with arbitrary data (e.g., currentUser, permissions, request metadata).
 */
export type UseCaseContext = {
  schema?: ObjectValidator;
} & Record<string, any>;

/**
 * Guard function that runs **before** schema validation.
 *
 * Guards are authorization/precondition checks. They receive a read-only
 * view of the input data and can enrich the context, but **must not** mutate
 * the input. Throw an error to abort the entire pipeline.
 *
 * @example
 * ```ts
 * const authGuard: UseCaseGuard<LoginInput> = async (data, ctx) => {
 *   const user = await getSession(ctx.token);
 *   if (!user) throw new UnauthorizedError();
 *   ctx.currentUser = user;
 * };
 * ```
 *
 * @template Input - The shape of the use case input data
 * @template Ctx - The shape of the shared context
 */
export type UseCaseGuard<Input, Ctx extends UseCaseContext = UseCaseContext> = (
  data: Readonly<Input>,
  ctx: Ctx,
) => void | Promise<void>;

/**
 * Before middleware that runs **after** schema validation.
 *
 * Receives validated data and must return the (optionally transformed) data.
 * Multiple before middlewares form a chain: output of one becomes input of next.
 *
 * @example
 * ```ts
 * const normalizeEmail: UseCaseBeforeMiddleware<SignupInput> = async (data) => {
 *   return { ...data, email: data.email.toLowerCase().trim() };
 * };
 * ```
 *
 * @template Input - The shape of the use case input data
 * @template Ctx - The shape of the shared context
 */
export type UseCaseBeforeMiddleware<Input, Ctx extends UseCaseContext = UseCaseContext> = (
  data: Input,
  ctx: Ctx,
) => Input | Promise<Input>;

/**
 * After middleware that runs **after** the handler succeeds.
 *
 * Fire-and-forget side effects: errors are caught and logged, never thrown.
 * Does **not** affect the returned output. Use for analytics, notifications,
 * cache invalidation, webhooks, etc.
 *
 * @example
 * ```ts
 * const notifySlack: UseCaseAfterMiddleware<OrderOutput> = async (output) => {
 *   await slack.send(`New order #${output.orderId} placed`);
 * };
 * ```
 *
 * @template Output - The shape of the use case output data
 * @template Ctx - The shape of the shared context
 */
export type UseCaseAfterMiddleware<Output, Ctx extends UseCaseContext = UseCaseContext> = (
  output: Output,
  ctx: Ctx,
) => void | Promise<void>;

/**
 * Context passed to `onExecuting` lifecycle event callbacks.
 * Fired at the start of each use case execution, before guards run.
 */
export type UseCaseOnExecutingContext = {
  /** The shared pipeline context */
  ctx: UseCaseContext;
  /** Unique execution ID */
  id: string;
  /** Use case name */
  name: string;
  /** Raw input data */
  data: any;
  /** Schema validator (if defined) */
  schema?: ObjectValidator;
  /** Timestamp when execution started */
  startedAt: Date;
};

/**
 * A broadcastable event emitted on successful completion.
 *
 * An envelope (not the bare payload) so consumers get a correlation `id` for
 * tracing/idempotency under at-least-once delivery.
 */
export type UseCaseBroadcastEvent = {
  /** Use case name */
  useCase: string;
  /** Channel/event name — defaults to the use case name */
  event: string;
  /** Execution id (correlation / idempotency) */
  id: string;
  /** Emission timestamp */
  at: Date;
  /** The output as-is, or the projected shape from `broadcast.output` */
  payload: unknown;
};

/**
 * Transport-neutral broadcast sink. Implemented by adapters (e.g. `heraldBroadcast`
 * from `@warlock.js/herald`) and registered globally via use-cases config.
 *
 * The use case only declares **what** to broadcast; the registered channels decide
 * **how** (which broker, transport, etc.).
 *
 * @example
 * ```ts
 * // src/config/use-cases.ts
 * broadcast: { enabled: true, channels: [heraldBroadcast({ broker: "default" })] }
 * ```
 */
export interface UseCaseBroadcastChannel {
  broadcast(event: UseCaseBroadcastEvent): void | Promise<void>;
}

/**
 * Per-use-case broadcast declaration — **what** to broadcast, no transport knobs.
 * `true` broadcasts the output as-is on the channel named after the use case.
 *
 * @template Output - The shape of the handler's return value
 */
export type UseCaseBroadcastOption<Output> =
  | boolean
  | {
      /** Channel/event name; defaults to the use case name */
      event?: string;
      /** Project the payload before broadcasting (e.g. strip sensitive fields) */
      output?: (output: Output, result: UseCaseResult<Output>) => unknown;
    };

/**
 * Use case definition.
 *
 * Defines the full execution pipeline: guards → validation → before → handler → after.
 * All fields except `name` and `handler` are optional.
 *
 * @example
 * ```ts
 * const createOrder = useCase<OrderOutput, OrderInput>({
 *   name: "create_order",
 *   description: "Create a new order",
 *   guards: [authGuard],
 *   schema: createOrderSchema,
 *   before: [enrichWithPricing],
 *   handler: async (data, ctx) => orderService.create(data, ctx.currentUser),
 *   after: [sendConfirmationEmail],
 *   retry: { attempts: 3, delay: 500, backoff: "exponential" },
 *   benchmark: true,
 *   broadcast: true,
 * });
 * ```
 *
 * @template Output - The shape of the handler's return value
 * @template Input - The shape of the input data (before transformation)
 * @template Ctx - The shape of the shared context
 */
export type UseCase<Output = any, Input = any, Ctx extends UseCaseContext = UseCaseContext> = {
  /** Unique use case identifier, used for registration, logging, and cache keys */
  name: string;
  /** Human-readable description, surfaced in the registry and observability */
  description?: string;
  /** Core business logic handler. Receives validated + transformed data and context */
  handler: (data: Input, ctx: Ctx) => Promise<Output>;
  /** Optional schema validator (from @warlock.js/seal). Runs after guards */
  schema?: ObjectValidator;
  /** Guards to run before validation. Sequential, can enrich ctx, cannot mutate data */
  guards?: UseCaseGuard<Input, Ctx>[];
  /** Before middleware to run after validation. Sequential, can transform data */
  before?: UseCaseBeforeMiddleware<Input, Ctx>[];
  /** After middleware to run on success. Fire-and-forget, errors are logged not thrown */
  after?: UseCaseAfterMiddleware<Output, Ctx>[];
  /** Lifecycle callback: fires when execution starts (before guards) */
  onExecuting?: (ctx: UseCaseOnExecutingContext) => void;
  /** Lifecycle callback: fires on successful completion with full result snapshot */
  onCompleted?: (result: UseCaseResult<Output>) => void;
  /** Lifecycle callback: fires on error with error details and execution context */
  onError?: (ctx: UseCaseErrorResult) => void;
  /**
   * Retry configuration (from `@mongez/reinforcements`). When set, the **handler**
   * is retried on failure. Opt-in — omitted means the handler runs exactly once.
   */
  retry?: RetryOptions;
  /**
   * Benchmark the handler. `true` uses global config defaults, an object customizes
   * thresholds/hooks, `false` disables. Measures the handler only — not the prelude.
   */
  benchmark?: boolean | BenchmarkOptions;
  /**
   * Broadcast the result on success through the globally-configured channels.
   * `true` sends the output as-is; an object can rename the event and project the payload.
   */
  broadcast?: UseCaseBroadcastOption<Output>;
};

/**
 * Use case definition whose `Input` is inferred from a **required** schema.
 * Backs the inference overload of `useCase()` so callers skip the manual generic.
 *
 * @template Output - The shape of the handler's return value
 * @template Schema - The schema validator the input is inferred from
 * @template Ctx - The shape of the shared context
 */
export type UseCaseWithSchema<
  Output,
  Schema extends ObjectValidator,
  Ctx extends UseCaseContext = UseCaseContext,
> = Omit<UseCase<Output, Infer<Schema>, Ctx>, "schema"> & {
  schema: Schema;
};

/**
 * The executable returned by `useCase()`. Call it with the input data and optional
 * runtime options; `$cleanup` unregisters the use case and drops its history.
 *
 * @template Output - The shape of the handler's return value
 * @template Input - The shape of the input data
 */
export type UseCaseHandler<Output, Input> = ((
  data: Input,
  options?: UseCaseRuntimeOptions<Output>,
) => Promise<Output>) & {
  $cleanup: () => void;
};

/**
 * A registered use case with call tracking metadata.
 * Created internally when a use case is registered via `useCase()`.
 */
export type RegisteredUseCase<Output = any, Input = any> = UseCase<Output, Input> & {
  /** Execution call counters */
  calls: {
    /** Number of successful executions */
    success: number;
    /** Number of failed executions */
    failed: number;
    /** Total executions (success + failed) */
    total: number;
  };
};

/**
 * Runtime options passed at invocation time (second argument to the executor).
 * These override or supplement the use case definition for a single execution.
 *
 * @example
 * ```ts
 * await createOrder(orderData, {
 *   id: "order-123",
 *   ctx: { currentUser },
 *   onCompleted: (result) => console.log("Order created:", result.output),
 * });
 * ```
 *
 * @template Output - The shape of the use case output data
 */
export type UseCaseRuntimeOptions<Output = any> = {
  /** Override the auto-generated execution ID */
  id?: string;
  /** Provide a pre-populated context object */
  ctx?: UseCaseContext;
  /** Invocation-level lifecycle callback: fires first, before use case and global */
  onExecuting?: (ctx: UseCaseOnExecutingContext) => void;
  /** Invocation-level lifecycle callback: fires first on success */
  onCompleted?: (result: UseCaseResult<Output>) => void;
  /** Invocation-level lifecycle callback: fires first on error */
  onError?: (ctx: UseCaseErrorResult) => void;
};

/**
 * Error result snapshot, emitted via `onError` lifecycle callbacks.
 * Contains all fields from `UseCaseResult` except `output`, plus the thrown error.
 */
export type UseCaseErrorResult = Omit<UseCaseResult, "output"> & {
  /** The error that caused the failure */
  error: Error;
};

/**
 * Success result snapshot, emitted via `onCompleted` lifecycle callbacks
 * and stored in execution history cache.
 *
 * @template Output - The shape of the handler's return value
 */
export type UseCaseResult<Output = any> = {
  /** Handler return value (undefined if execution failed) */
  output?: Output;
  /** The pipeline context at time of completion */
  ctx: UseCaseContext;
  /** Timestamp when execution started */
  startedAt: Date;
  /** Timestamp when execution ended */
  endedAt: Date;
  /** Unique execution ID */
  id: string;
  /** Use case name */
  name: string;
  /** Success or failed call count at time of completion (matches the outcome) */
  calls: number;
  /** Retry state (present only if retry was configured) */
  retries?: {
    /** Total allowed attempts (initial try + retries) */
    attempts: number;
    /** Delay between attempts in ms */
    delay?: number;
    /** Actual retry attempts performed (0 = succeeded on first try) */
    currentRetry: number;
  };
  /** Benchmark result (present only if benchmark was enabled) */
  benchmarkResult?: {
    /** Execution time in milliseconds */
    latency: number;
    /** Performance classification */
    state: "poor" | "good" | "excellent";
  };
};

/**
 * Internal registry of global lifecycle event callback arrays.
 * Used by `globalUseCasesEvents` to manage subscriptions.
 */
export type UseCaseEventsCallbacksMap = {
  onExecuting: ((ctx: UseCaseOnExecutingContext) => void)[];
  onCompleted: ((result: UseCaseResult<any>) => void)[];
  onError: ((ctx: UseCaseErrorResult) => void)[];
};

/**
 * App-level configuration for use cases, resolved via `config.get("use-cases")`.
 * Provides default values that can be overridden per use case.
 *
 * @example
 * ```ts
 * // src/config/use-cases.ts
 * export default {
 *   benchmark: true,
 *   log: false,
 *   history: { enabled: true, ttl: 3600, maxEntries: 100 },
 *   broadcast: { enabled: true, channels: [heraldBroadcast()] },
 * } satisfies UseCaseConfigurations;
 * ```
 */
export type UseCaseConfigurations = {
  /**
   * Default retry for all use cases (from `@mongez/reinforcements`).
   * When set, every use case retries its handler unless it overrides `retry`.
   */
  retry?: RetryOptions;
  /**
   * Default benchmark setting for all use cases.
   * For standalone benchmark usage, use `config.get("benchmark")` instead.
   */
  benchmark?: boolean | BenchmarkOptions;
  /** Broadcast transport — registered channels plus a global kill-switch */
  broadcast?: {
    /** Global on/off — `false` disables broadcasting for every use case */
    enabled?: boolean;
    /** Channels every broadcast fans out to */
    channels?: UseCaseBroadcastChannel[];
  };
  /** Per-step debug logging through `@warlock.js/logger` (default: false) */
  log?: boolean;
  /** Execution history cache settings */
  history?: {
    /** Enable/disable history storage (default: true) */
    enabled?: boolean;
    /** Cache TTL in seconds (default: 3600). `false` uses the cache driver default */
    ttl?: number | false;
    /** Max history entries kept per use case before oldest are evicted (default: 100) */
    maxEntries?: number;
  };
};
