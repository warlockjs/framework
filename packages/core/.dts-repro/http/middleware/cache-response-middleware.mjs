import { except } from "@mongez/reinforcements";
import { cache } from "@warlock.js/cache";
//#region ../../@warlock.js/core/src/http/middleware/cache-response-middleware.ts
const defaultCacheOptions = { withLocale: true };
async function parseCacheOptions(cacheOptions, request) {
	if (typeof cacheOptions === "string") cacheOptions = { cacheKey: cacheOptions };
	if (typeof cacheOptions.cacheKey === "function") cacheOptions.cacheKey = await cacheOptions.cacheKey(request);
	const finalCacheOptions = {
		...defaultCacheOptions,
		...cacheOptions
	};
	if (finalCacheOptions.withLocale) {
		const locale = request.getLocaleCode();
		finalCacheOptions.cacheKey = `${finalCacheOptions.cacheKey}:${locale}`;
	}
	if (!finalCacheOptions.omit) finalCacheOptions.omit = ["user", "settings"];
	return finalCacheOptions;
}
function cacheMiddleware(responseCacheOptions) {
	return async function(request, response) {
		const { ttl, omit, cacheKey, driver } = await parseCacheOptions(responseCacheOptions, request);
		const cacheDriver = driver ? await cache.use(driver) : cache;
		const content = await cacheDriver.get(cacheKey);
		if (content) {
			const output = content.data;
			return response.baseResponse.send(output);
		}
		response.onSent((response) => {
			if (!response.isOk || response.request.path !== request.path) return;
			const content = { data: except(response.parsedBody, omit) };
			cacheDriver.set(cacheKey, content, ttl);
		});
	};
}
//#endregion
export { cacheMiddleware };

//# sourceMappingURL=cache-response-middleware.mjs.map