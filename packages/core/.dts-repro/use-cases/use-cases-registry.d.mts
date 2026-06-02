import { RegisteredUseCase, UseCase, UseCaseResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/use-cases/use-cases-registry.d.ts
/**
 * Register a use case
 */
declare function $registerUseCase<Output, Input>(name: string, useCase: RegisteredUseCase<Output, Input>): void;
/**
 * Unregister a use case
 */
declare function $unregisterUseCase(name: string): void;
/**
 * Get a use case
 */
declare function getUseCase<Output, Input>(name: string): UseCase<Output, Input> | undefined;
/**
 * Get all use cases
 */
declare function getUseCases(): Map<string, RegisteredUseCase>;
/**
 * Increase use case success calls
 */
declare function increaseUseCaseSuccessCalls(name: string): number;
/**
 * Increase use case failed calls
 */
declare function increaseUseCaseFailedCalls(name: string): number;
/**
 * Get use case history from cache.
 *
 * Prunes ids whose entries have expired so the list can't accumulate dead refs.
 */
declare function getUseCaseHistory(name: string): Promise<UseCaseResult<any>[]>;
/**
 * Add use case history to cache, capping the per-use-case list so it can't grow
 * unbounded — oldest entries (and their ids) are evicted past MAX_HISTORY_ENTRIES.
 */
declare function addUseCaseHistory(name: string, result: UseCaseResult<any>): Promise<void>;
//#endregion
export { $registerUseCase, $unregisterUseCase, addUseCaseHistory, getUseCase, getUseCaseHistory, getUseCases, increaseUseCaseFailedCalls, increaseUseCaseSuccessCalls };
//# sourceMappingURL=use-cases-registry.d.mts.map