import { UseCaseErrorResult, UseCaseEventsCallbacksMap, UseCaseOnExecutingContext, UseCaseResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/use-cases/use-case-events.d.ts
/**
 * Global event callbacks — shared across all use case instances.
 */
declare const globalEventsCallbacksMap: UseCaseEventsCallbacksMap;
/**
 * Subscribe to lifecycle events fired by any use case.
 *
 * @example
 * globalUseCasesEvents.onCompleted((result) => metrics.track(result.name, result.benchmarkResult));
 * globalUseCasesEvents.onError((ctx) => logger.error(ctx.name, ctx.error));
 */
declare const globalUseCasesEvents: {
  onExecuting(callback: (ctx: UseCaseOnExecutingContext) => void): {
    unsubscribe: () => void;
  };
  onCompleted<Output>(callback: (result: UseCaseResult<Output>) => void): {
    unsubscribe: () => void;
  };
  onError(callback: (ctx: UseCaseErrorResult) => void): {
    unsubscribe: () => void;
  };
};
/**
 * Dispatches a lifecycle event to invocation → use-case → global observers, in that order.
 *
 * Each observer is awaited sequentially and isolated in its own try/catch — a slow
 * observer can't stall the others, and a throwing one can't break the pipeline (e.g.
 * a successful use case must not fail because a metrics/broadcast observer threw).
 */
declare function fireLifecycleEvent<EventCtx>(ctx: EventCtx, observers: {
  invocation?: ((ctx: EventCtx) => void | Promise<void>)[];
  useCase?: ((ctx: EventCtx) => void | Promise<void>)[];
  global?: ((ctx: EventCtx) => void | Promise<void>)[];
}): Promise<void>;
//#endregion
export { fireLifecycleEvent, globalEventsCallbacksMap, globalUseCasesEvents };
//# sourceMappingURL=use-case-events.d.mts.map