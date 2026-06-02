import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import { log } from "@warlock.js/logger";
import { cache } from "@warlock.js/cache";
//#region ../../@warlock.js/core/src/use-cases/use-cases-registry.ts
/**
* Store registered use cases
*/
const useCaseRegister = /* @__PURE__ */ new Map();
/**
* Register a use case
*/
function $registerUseCase(name, useCase) {
	if (useCaseRegister.has(name) && process.env.NODE_ENV !== "production") log.warn("use-cases", "registering", `Use case "${name}" is already registered. Overwriting.`);
	useCaseRegister.set(name, useCase);
}
/**
* Unregister a use case
*/
function $unregisterUseCase(name) {
	useCaseRegister.delete(name);
	cache.removeNamespace(`use-case:history:${name}`);
}
/**
* Get a use case
*/
function getUseCase(name) {
	return useCaseRegister.get(name);
}
/**
* Get all use cases
*/
function getUseCases() {
	return useCaseRegister;
}
/**
* Increase use case success calls
*/
function increaseUseCaseSuccessCalls(name) {
	const useCase = useCaseRegister.get(name);
	if (useCase) {
		useCase.calls.success++;
		useCase.calls.total++;
		return useCase.calls.success;
	}
	return 0;
}
/**
* Increase use case failed calls
*/
function increaseUseCaseFailedCalls(name) {
	const useCase = useCaseRegister.get(name);
	if (useCase) {
		useCase.calls.failed++;
		useCase.calls.total++;
		return useCase.calls.failed;
	}
	return 0;
}
/**
* Resolve the history cache TTL (seconds) from config.
* `false` means "use the cache driver's default", represented as `undefined`.
*/
function resolveHistoryTtl(useCaseConfig) {
	const ttlConfig = useCaseConfig?.history?.ttl ?? 3600;
	return ttlConfig === false ? void 0 : ttlConfig;
}
/**
* Get use case history from cache.
*
* Prunes ids whose entries have expired so the list can't accumulate dead refs.
*/
async function getUseCaseHistory(name) {
	const listKey = `use-case:history:${name}:list`;
	const ids = await cache.get(listKey) || [];
	const liveEntries = (await Promise.all(ids.map(async (id) => ({
		id,
		result: await cache.get(`use-case:history:${name}:${id}`)
	})))).filter((entry) => Boolean(entry.result));
	if (liveEntries.length !== ids.length) {
		const useCaseConfig = config.get("use-cases");
		await cache.set(listKey, liveEntries.map((entry) => entry.id), resolveHistoryTtl(useCaseConfig));
	}
	return liveEntries.map((entry) => entry.result);
}
/**
* Add use case history to cache, capping the per-use-case list so it can't grow
* unbounded — oldest entries (and their ids) are evicted past MAX_HISTORY_ENTRIES.
*/
async function addUseCaseHistory(name, result) {
	const useCaseConfig = config.get("use-cases");
	if (useCaseConfig?.history?.enabled === false) return;
	const ttl = resolveHistoryTtl(useCaseConfig);
	const maxEntries = useCaseConfig?.history?.maxEntries ?? 100;
	const key = `use-case:history:${name}:${result.id}`;
	const listKey = `use-case:history:${name}:list`;
	await cache.set(key, result, ttl);
	const list = await cache.get(listKey) || [];
	list.push(result.id);
	while (list.length > maxEntries) {
		const evictedId = list.shift();
		if (evictedId) await cache.remove(`use-case:history:${name}:${evictedId}`);
	}
	await cache.set(listKey, list, ttl);
}
//#endregion
export { $registerUseCase, $unregisterUseCase, addUseCaseHistory, getUseCase, getUseCaseHistory, getUseCases, increaseUseCaseFailedCalls, increaseUseCaseSuccessCalls };

//# sourceMappingURL=use-cases-registry.mjs.map