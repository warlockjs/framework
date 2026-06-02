import { Request } from "../request.mjs";
import { Response } from "../response.mjs";
import { ReturnedResponse } from "../types.mjs";

//#region ../../@warlock.js/core/src/http/middleware/inject-request-context.d.ts
/**
 * Create request store and execute middleware + handler
 *
 * Runs all registered contexts together using ContextManager.
 */
declare function createRequestStore(request: Request<any>, response: Response): Promise<ReturnedResponse>;
/**
 * Translate a keyword (uses request context for locale)
 */
declare function t(keyword: string, placeholders?: any): any;
/**
 * Get or compute a value from the request cache
 *
 * If the value exists in request, return it.
 * Otherwise, execute callback, store result in request, and return it.
 */
declare function fromRequest<T>(key: string, callback: (request?: Request) => Promise<T>): Promise<T>;
//#endregion
export { createRequestStore, fromRequest, t };
//# sourceMappingURL=inject-request-context.d.mts.map