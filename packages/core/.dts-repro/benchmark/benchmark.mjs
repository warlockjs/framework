import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
//#region ../../@warlock.js/core/src/benchmark/benchmark.ts
/**
* Classifies latency into "excellent", "good", or "poor" based on thresholds.
*
* @example
* latencyState(80, { excellent: 100, poor: 500 })  // "excellent"
* latencyState(300, { excellent: 100, poor: 500 }) // "good"
* latencyState(600, { excellent: 100, poor: 500 }) // "poor"
*/
function latencyState(latency, range) {
	if (latency <= range.excellent) return "excellent";
	if (latency >= range.poor) return "poor";
	return "good";
}
/**
* Measure the execution time of a function and classify its performance.
*
* When `enabled` is false, fn() is still called but no timing runs and no hooks fire.
* A zeroed SuccessResult is returned to keep the return type stable for all callers.
*
* @example
* ```ts
* const result = await measure("db-query", () => db.query("SELECT 1"), {
*   latencyRange: { excellent: 100, poor: 500 },
*   onComplete: (r) => metrics.record(r.latency),
*   onError:    (r) => logger.error("query failed", r.error),
*   onFinish:   (r) => logger.info(`${r.name} took ${r.latency}ms`),
* });
*
* if (result.success) {
*   console.log(result.value);
* } else {
*   console.error(result.error);
* }
* ```
*/
async function measure(name, fn, options) {
	if (options?.enabled === false) return {
		name,
		success: true,
		value: await fn(),
		latency: 0,
		state: "excellent",
		tags: options.tags,
		startedAt: /* @__PURE__ */ new Date(),
		endedAt: /* @__PURE__ */ new Date()
	};
	const benchmarkConfig = config.get("benchmark");
	const latencyRange = options?.latencyRange ?? benchmarkConfig?.latencyRange;
	const startedAt = /* @__PURE__ */ new Date();
	const startTime = performance.now();
	const profiler = options?.profiler ?? benchmarkConfig?.profiler;
	const snapshotContainer = options?.snapshotContainer ?? benchmarkConfig?.snapshotContainer;
	try {
		const value = await fn();
		const endTime = performance.now();
		const latency = Math.round(endTime - startTime);
		const result = {
			name,
			success: true,
			value,
			latency,
			state: latencyRange ? latencyState(latency, latencyRange) : "good",
			tags: options?.tags,
			startedAt,
			endedAt: /* @__PURE__ */ new Date()
		};
		if (profiler) profiler.record(result);
		if (snapshotContainer) snapshotContainer.record(result);
		options?.onComplete?.(result);
		options?.onFinish?.(result);
		return result;
	} catch (thrown) {
		if (!(options?.shouldBenchmarkError ? options.shouldBenchmarkError(thrown) : true)) throw thrown;
		const endTime = performance.now();
		const latency = Math.round(endTime - startTime);
		const state = latencyRange ? latencyState(latency, latencyRange) : "poor";
		const result = {
			name,
			success: false,
			error: thrown instanceof Error ? thrown : new Error(String(thrown)),
			latency,
			state,
			tags: options?.tags,
			startedAt,
			endedAt: /* @__PURE__ */ new Date()
		};
		if (profiler) profiler.record(result);
		if (snapshotContainer) snapshotContainer.record(result);
		options?.onError?.(result);
		options?.onFinish?.(result);
		return result;
	}
}
//#endregion
export { measure };

//# sourceMappingURL=benchmark.mjs.map