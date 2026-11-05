import type { AgentMiddleware, MiddlewareExecuteContext } from "../contracts/middleware";
import type { ModelContract } from "../contracts/model.contract";
import { runPipeline } from "./pipeline";

/** Options for {@link wrapModelWithMiddleware}. */
export type WrapModelOptions = {
  /** Name the middleware sees as `context.agent.name`. Default `"model"`. */
  name?: string;
};

/**
 * Wrap a model so every `complete()` call goes through the `trip`-level
 * hooks of `middleware`, the same hooks an agent runs around each of its
 * model calls. The `execute`-level `before` hooks run once, before the
 * first call, and the wrapper keeps one middleware state for its lifetime:
 * a `budget()` cap therefore counts every call made through the wrapper.
 *
 * `stream()` and `countTokens()` are passed through unchanged.
 *
 * @example
 * const metered = ai.middleware.budget({ maxCostUSD: 0.5, reserve: { outputTokens: 2_000 } }).wrapModel(model);
 * await metered.complete(messages);
 */
export function wrapModelWithMiddleware(
  model: ModelContract,
  middleware: readonly AgentMiddleware[],
  options: WrapModelOptions = {},
): ModelContract {
  if (middleware.length === 0) return model;

  const state = new Map<string, unknown>();
  let tripIndex = 0;
  let started: Promise<void> | undefined;

  const context = (signal: AbortSignal | undefined): MiddlewareExecuteContext => ({
    agent: { name: options.name ?? "model", isAnonymous: !options.name },
    model: { name: model.name, provider: model.provider, pricing: model.pricing },
    input: "",
    options: undefined,
    state,
    signal,
  });

  return {
    name: model.name,
    provider: model.provider,
    capabilities: model.capabilities,
    pricing: model.pricing,
    stream: (messages, callOptions) => model.stream(messages, callOptions),
    ...(model.countTokens
      ? { countTokens: (messages, callOptions) => model.countTokens!(messages, callOptions) }
      : {}),
    async complete(messages, callOptions) {
      const base = context(callOptions?.signal);

      started ??= (async () => {
        for (const entry of middleware) {
          await entry.execute?.before?.(base);
        }
      })();

      try {
        await started;
      } catch (error) {
        started = undefined;
        throw error;
      }

      return runPipeline(
        middleware,
        "trip",
        { ...base, tripIndex: tripIndex++, messages },
        () => model.complete(messages, callOptions),
      );
    },
  };
}
