import { except } from "@mongez/reinforcements";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import type { Middleware } from "../../router/types";
import type { Request } from "./../request";
import type { Response } from "./../response";

/**
 * Shape persisted to the cache for a cached response. Stores the status and
 * content-type alongside the body so the HIT path can replay the response
 * faithfully via {@link Response.replay} instead of re-entering `send()`.
 */
type CachedResponsePayload = {
  status: number;
  data: unknown;
  contentType?: string;
};

// TODO: Add option to determine whether to cache the response or not
// TODO: add option to determine what to be cached from the response
// TODO: add cache middleware config options for example to set the default driver, ttl, etc

export type CacheMiddlewareOptions = {
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
  /**
   * Tags this cached response is stored under, mirroring `route.cache.tags`
   * on `@warlock.js/web`'s page cache (`PageCacheOptIn.tags`,
   * `web/src/routing/route-identity.ts`) so the two caches share one mental
   * model: `cache.tags([...]).invalidate()` from `@warlock.js/cache` evicts
   * a tagged API response the same way it evicts a tagged page. Either a
   * static list, or a function of the request — resolved once per request,
   * right before the response is stored.
   *
   * @default undefined (untagged — behaves exactly as before this option existed)
   */
  tags?: string[] | ((request: Request) => string[]);
};

const defaultCacheOptions: Partial<CacheMiddlewareOptions> = {
  withLocale: true,
};

type ParsedCacheOptions = Required<Omit<CacheMiddlewareOptions, "tags">> & {
  cacheKey: string;
  /** Resolved, concrete tag list — see {@link resolveCacheTags}. */
  tags: string[];
};

/**
 * Resolves `CacheMiddlewareOptions.tags` — a static list or a function of
 * the request — into a concrete list at store time. Mirrors
 * `resolveCacheTags` in `@warlock.js/web`'s `create-page-route-handler.ts`,
 * the equivalent seam for `route.cache.tags`.
 */
function resolveCacheTags(tags: CacheMiddlewareOptions["tags"], request: Request): string[] {
  if (tags === undefined) return [];

  return typeof tags === "function" ? tags(request) : tags;
}

async function parseCacheOptions(cacheOptions: CacheMiddlewareOptions | string, request: Request) {
  if (typeof cacheOptions === "string") {
    cacheOptions = {
      cacheKey: cacheOptions,
    };
  }

  if (typeof cacheOptions.cacheKey === "function") {
    cacheOptions.cacheKey = await cacheOptions.cacheKey(request);
  }

  const tags = resolveCacheTags(cacheOptions.tags, request);

  const finalCacheOptions = {
    ...defaultCacheOptions,
    ...cacheOptions,
    tags,
  } as ParsedCacheOptions;

  if (finalCacheOptions.withLocale) {
    const locale = request.getLocaleCode();

    finalCacheOptions.cacheKey = `${finalCacheOptions.cacheKey}:${locale}`;
  }

  if (!finalCacheOptions.omit) {
    finalCacheOptions.omit = ["user", "settings"];
  }

  return finalCacheOptions;
}

export function cacheMiddleware(responseCacheOptions: CacheMiddlewareOptions | string): Middleware {
  // The `Middleware` return annotation is load-bearing: without it, tsc never
  // checks this factory's calling convention, which is how the positional v4
  // shape survived an earlier refactor unnoticed.
  return async function ({ request, response }) {
    const { ttl, omit, cacheKey, driver, tags } = await parseCacheOptions(
      responseCacheOptions,
      request,
    );
    const cacheDriver = driver ? await cache.use(driver) : cache;

    const content = (await cacheDriver.get(cacheKey)) as CachedResponsePayload | null;

    if (content) {
      // Replay through the standard pipeline (status + content-type preserved)
      // instead of `baseResponse.send()`, which would re-enter Response.send()
      // on an already-sent reply, trip the double-send guard, and drop the
      // status / content-type.
      return response.replay({
        status: content.status ?? 200,
        body: content.data,
        contentType: content.contentType,
      });
    }

    response.onSent((response: Response) => {
      if (!response.isOk || response.request.path !== request.path) {
        return;
      }

      const sentContentType = response.contentType;

      const content: CachedResponsePayload = {
        status: response.statusCode,
        data: except(response.parsedBody, omit),
        contentType: typeof sentContentType === "string" ? sentContentType : undefined,
      };

      // `set` is fire-and-forget inside `onSent`; without a `.catch` a rejected
      // write (e.g. Redis down) would surface as an unhandledRejection.
      //
      // Tagged and untagged writes go through separate calls rather than a
      // shared branch-free path so an untagged route's write stays byte
      // identical to what it was before `tags` existed.
      const write =
        tags.length > 0
          ? cacheDriver.tags(tags).set(cacheKey, content, ttl)
          : cacheDriver.set(cacheKey, content, ttl);

      write.catch((error: unknown) => {
        log.error("cache-middleware", "set", error);
      });
    });
  };
}
