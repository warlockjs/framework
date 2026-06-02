import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import { measure } from "../benchmark/benchmark.mjs";
import "../benchmark/index.mjs";
import { broadcastUseCaseResult } from "./use-case-broadcast.mjs";
import { fireLifecycleEvent, globalEventsCallbacksMap } from "./use-case-events.mjs";
import { runPipeline } from "./use-case-pipeline.mjs";
import { $registerUseCase, $unregisterUseCase, addUseCaseHistory, increaseUseCaseFailedCalls, increaseUseCaseSuccessCalls } from "./use-cases-registry.mjs";
import { log } from "@warlock.js/logger";
import { Random, except, retry } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/use-cases/use-case.ts
const defaultUseCaseOptions = { benchmark: true };
function useCase(options) {
	const { name, handler, schema, guards, before, after, onExecuting, onCompleted, onError } = options;
	const useCaseConfig = config.get("use-cases", defaultUseCaseOptions);
	const benchmark = options.benchmark ?? useCaseConfig?.benchmark ?? true;
	const retryConfig = options.retry ?? useCaseConfig?.retry;
	const broadcast = options.broadcast;
	const broadcastConfig = useCaseConfig?.broadcast;
	const logEnabled = useCaseConfig?.log === true;
	$registerUseCase(name, {
		...options,
		calls: {
			success: 0,
			failed: 0,
			total: 0
		}
	});
	const useCaseHandler = async (data, { ctx = {}, id = `uc-${name}-` + Random.string(), onExecuting: invocationOnExecuting, onCompleted: invocationOnCompleted, onError: invocationOnError } = {}) => {
		ctx.schema = schema;
		ctx.id = id;
		const startedAt = /* @__PURE__ */ new Date();
		let output;
		let error;
		let benchmarkResult;
		let currentRetry = 0;
		if (logEnabled) log.debug("use-cases", name, "executing", { id });
		try {
			const transformed = await runPipeline({
				name,
				id,
				data,
				ctx,
				startedAt,
				schema,
				guards,
				before,
				onExecuting: invocationOnExecuting,
				ucOnExecuting: onExecuting
			});
			const runHandler = async () => {
				if (!benchmark) return handler(transformed, ctx);
				const measured = await measure(name, () => handler(transformed, ctx), benchmark === true ? void 0 : benchmark);
				benchmarkResult = {
					latency: measured.latency,
					state: measured.state
				};
				if (!measured.success) throw measured.error;
				return measured.value;
			};
			output = retryConfig ? await retry(runHandler, {
				...retryConfig,
				onError: (retryError, attempt) => {
					currentRetry = attempt;
					retryConfig.onError?.(retryError, attempt);
				}
			}) : await runHandler();
		} catch (err) {
			error = err;
		}
		const endedAt = /* @__PURE__ */ new Date();
		if (!error && after && output !== void 0) for (const middleware of after) try {
			await middleware(output, ctx);
		} catch (afterError) {
			log.error("use-cases", name, "after middleware failed", { error: afterError });
		}
		const snapshot = {
			output,
			ctx,
			startedAt,
			endedAt,
			id,
			name,
			retries: retryConfig ? {
				attempts: retryConfig.attempts ?? 3,
				delay: retryConfig.delay,
				currentRetry
			} : void 0,
			benchmarkResult,
			calls: 0
		};
		if (error) {
			snapshot.calls = increaseUseCaseFailedCalls(name);
			if (logEnabled) log.error("use-cases", name, "failed", {
				id,
				error
			});
			await fireLifecycleEvent({
				...except(snapshot, ["output"]),
				error
			}, {
				invocation: invocationOnError ? [invocationOnError] : void 0,
				useCase: onError ? [onError] : void 0,
				global: globalEventsCallbacksMap.onError.length ? globalEventsCallbacksMap.onError : void 0
			});
			throw error;
		}
		snapshot.calls = increaseUseCaseSuccessCalls(name);
		if (logEnabled) log.debug("use-cases", name, "completed", {
			id,
			latency: benchmarkResult?.latency
		});
		await addUseCaseHistory(name, snapshot);
		await fireLifecycleEvent(snapshot, {
			invocation: invocationOnCompleted ? [invocationOnCompleted] : void 0,
			useCase: onCompleted ? [onCompleted] : void 0,
			global: globalEventsCallbacksMap.onCompleted.length ? globalEventsCallbacksMap.onCompleted : void 0
		});
		await broadcastUseCaseResult({
			name,
			id,
			output,
			result: snapshot,
			broadcast,
			config: broadcastConfig
		});
		return output;
	};
	useCaseHandler.$cleanup = () => {
		$unregisterUseCase(name);
	};
	return useCaseHandler;
}
//#endregion
export { useCase };

//# sourceMappingURL=use-case.mjs.map