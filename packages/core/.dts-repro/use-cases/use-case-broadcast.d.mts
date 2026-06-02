import { UseCaseBroadcastOption, UseCaseConfigurations, UseCaseResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/use-cases/use-case-broadcast.d.ts
/**
 * Broadcast a successful use-case result through the globally-configured channels.
 *
 * Fires only when the use case opted in (`broadcast`) and the global transport is
 * enabled with at least one channel. Fan-out is isolated via `Promise.allSettled` —
 * a failing channel is logged and never affects the use case or sibling channels.
 *
 * @example
 * await broadcastUseCaseResult({ name, id, output, result, broadcast, config });
 */
declare function broadcastUseCaseResult<Output>(params: {
  name: string;
  id: string;
  output: Output;
  result: UseCaseResult<Output>;
  broadcast?: UseCaseBroadcastOption<Output>;
  config?: UseCaseConfigurations["broadcast"];
}): Promise<void>;
//#endregion
export { broadcastUseCaseResult };
//# sourceMappingURL=use-case-broadcast.d.mts.map