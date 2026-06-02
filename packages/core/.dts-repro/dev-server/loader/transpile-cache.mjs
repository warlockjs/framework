import { createHash } from "node:crypto";
import "node:path";
//#region ../../@warlock.js/core/src/dev-server/loader/transpile-cache.ts
/**
* Persisted transpile cache.
*
* Keyed by a hash of *source content* plus a transform-options fingerprint.
* Same source + same options → same key → same output, always. Changed
* content → different key → fresh transpile. There is no path-keyed entry
* anywhere, so the old "stack trace points at a mangled cache filename" bug
* class is structurally impossible — the on-disk filename is opaque and the
* source identity lives only inside the source map.
*
* This module is pure and hook-agnostic on purpose: it knows how to read,
* write and evict cache entries given a key, nothing about the ESM loader,
* `?v=N` versioning, or esbuild. Phase 2 wires it into the load hook.
*
* @example
*   const fp = computeFingerprint({
*     esbuildVersion: esbuild.version,
*     cacheEpoch: CACHE_EPOCH,
*     compilerOptions,
*   });
*   const key = cacheKey(sourceText, fp);
*   const hit = cache.get(key);
*   if (!hit) cache.put(key, { code, map });
*/
/**
* Stable JSON stringify — object keys sorted recursively so semantically
* equal option blobs always produce the same fingerprint regardless of key
* insertion order.
*/
function stableStringify(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	return `{${Object.keys(value).sort().map((key) => {
		const child = stableStringify(value[key]);
		return `${JSON.stringify(key)}:${child}`;
	}).join(",")}}`;
}
/**
* Fold every output-affecting input into one short hex fingerprint that
* becomes part of every cache key.
*/
function computeFingerprint(parts) {
	const canonical = stableStringify({
		esbuildVersion: parts.esbuildVersion,
		cacheEpoch: parts.cacheEpoch,
		compilerOptions: parts.compilerOptions
	});
	return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
//#endregion
export { computeFingerprint };

//# sourceMappingURL=transpile-cache.mjs.map