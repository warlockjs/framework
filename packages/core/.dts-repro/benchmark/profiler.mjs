import { NoopChannel } from "./channels/noop.channel.mjs";
//#region ../../@warlock.js/core/src/benchmark/profiler.ts
var BenchmarkProfiler = class {
	constructor(options) {
		this.entries = /* @__PURE__ */ new Map();
		this.maxSamples = options?.maxSamples ?? 1e3;
		this.channels = options?.channels ?? [new NoopChannel()];
		if (options?.flushEvery) this.interval = setInterval(() => {
			this.flush();
		}, options.flushEvery);
	}
	/**
	* Record one measurement result. Called automatically by measure() when a profiler is set.
	*
	* @param result - The success or error result from measure()
	*
	* @example
	* profiler.record(result);
	*/
	record(result) {
		let entry = this.entries.get(result.name);
		if (!entry) {
			entry = {
				latencies: [],
				sum: 0,
				total: 0,
				errors: 0,
				firstSeenAt: result.startedAt,
				lastSeenAt: result.endedAt
			};
			this.entries.set(result.name, entry);
		}
		entry.latencies.push(result.latency);
		entry.sum += result.latency;
		if (entry.latencies.length > this.maxSamples) {
			const removed = entry.latencies.shift();
			if (removed !== void 0) entry.sum -= removed;
		}
		entry.total += 1;
		if (!result.success) entry.errors += 1;
		entry.lastSeenAt = result.endedAt;
	}
	/**
	* Get aggregated stats for one operation name.
	* Computes p50/p95/p99 by sorting the ring buffer on demand.
	*
	* @param name - The operation name to get stats for.
	* @returns Stats object or undefined if no data yet.
	*
	* @example
	* const stats = profiler.stats("db-query");
	*/
	stats(name) {
		const entry = this.entries.get(name);
		if (!entry || entry.latencies.length === 0) return void 0;
		const latencies = [...entry.latencies].sort((a, b) => a - b);
		const count = latencies.length;
		const getP = (percentile) => {
			return latencies[Math.min(count - 1, Math.floor(count * percentile))];
		};
		return {
			p50: getP(.5),
			p90: getP(.9),
			p95: getP(.95),
			p99: getP(.99),
			avg: Math.round(entry.sum / count * 100) / 100,
			min: latencies[0],
			max: latencies[count - 1],
			count: entry.total,
			errors: entry.errors,
			errorRate: Math.round(entry.errors / entry.total * 100) / 100,
			firstSeenAt: entry.firstSeenAt,
			lastSeenAt: entry.lastSeenAt
		};
	}
	/**
	* Get stats for all tracked operations.
	*
	* @returns A record mapping operation names to their stats.
	*
	* @example
	* const all = profiler.allStats();
	*/
	allStats() {
		const all = {};
		for (const name of this.entries.keys()) {
			const operationStats = this.stats(name);
			if (operationStats) all[name] = operationStats;
		}
		return all;
	}
	/**
	* Send allStats() to all registered channels.
	*
	* @example
	* await profiler.flush();
	*/
	async flush() {
		const stats = this.allStats();
		if (Object.keys(stats).length === 0) return;
		for (const channel of this.channels) await channel.onFlush(stats);
	}
	/**
	* Clear ring buffer for one or all operations.
	* Does NOT reset unbounded total/error counters.
	*
	* @param name - Optional operation name. If omitted, clears all ring buffers.
	*
	* @example
	* profiler.reset("db-query");
	* profiler.reset();
	*/
	reset(name) {
		if (name) {
			const entry = this.entries.get(name);
			if (entry) {
				entry.latencies = [];
				entry.sum = 0;
			}
		} else for (const entry of this.entries.values()) {
			entry.latencies = [];
			entry.sum = 0;
		}
	}
	/**
	* Dispose the profiler, clearing its auto-flush interval.
	*
	* @example
	* profiler.dispose();
	*/
	dispose() {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = void 0;
		}
	}
};
//#endregion
export { BenchmarkProfiler };

//# sourceMappingURL=profiler.mjs.map