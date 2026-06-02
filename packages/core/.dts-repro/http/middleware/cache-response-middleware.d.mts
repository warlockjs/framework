import { Request } from "../request.mjs";
import { Response } from "../response.mjs";

//#region ../../@warlock.js/core/src/http/middleware/cache-response-middleware.d.ts
type CacheMiddlewareOptions = {
  /**
   * Cache key
   */
  cacheKey: string | ((request: Request) => string) | ((request: Request) => Promise<string>);
  /**
   * If true, then the response will be cached based on the current locale code
   * This is useful when you have a multi-language website, and you want to cache the response based on the current locale
   *
   * @default true
   */
  withLocale?: boolean;
  /**
   * List of keys from the response object to omit from the cached response
   *
   * @default ['user']
   */
  omit?: string[];
  /**
   * Expires after number of seconds
   */
  ttl?: number;
  /**
   * Cache driver
   *
   * @see config/cache.ts: drivers object
   * @default cache manager
   */
  driver?: string;
};
declare function cacheMiddleware(responseCacheOptions: CacheMiddlewareOptions | string): (request: Request, response: Response) => Promise<undefined>;
//#endregion
export { CacheMiddlewareOptions, cacheMiddleware };
//# sourceMappingURL=cache-response-middleware.d.mts.map