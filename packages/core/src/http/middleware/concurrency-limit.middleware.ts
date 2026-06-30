import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import type { Request } from "../request";
import type { Response } from "../response";
import { t } from "./inject-request-context";

/**
 * Options for the concurrency limit middleware.
 */
export type ConcurrencyLimitOptions = {
  /**
   * Group key generator. Defaults to `request.route.path` — i.e. the cap
   * applies across all callers of that route. Override to scope per-user
   * or per-tenant.
   *
   * @example
   * keyGenerator: (request) => `${request.route.path}:${request.user?.id ?? request.ip}`,
   */
  keyGenerator?: (request: Request) => string;
  /**
   * Override the default error message.
   */
  errorMessage?: string;
};

const counters = new Map<string, number>();

function release(key: string) {
  const after = (counters.get(key) || 1) - 1;

  if (after <= 0) {
    counters.delete(key);

    return;
  }

  counters.set(key, after);
}

/**
 * Cap the number of in-flight requests against a route. Above the cap, new
 * requests get a fast 429 + `Retry-After: 1` — no queue, no timeout.
 *
 * Use for endpoints whose cost is unbounded per-request: report generation,
 * AI completions, image processing, expensive aggregations. Different from
 * `rateLimit()` — rate-limit caps requests-per-time, concurrency caps
 * in-flight requests at any instant.
 *
 * The counter is process-local. With `N` replicas the effective cap is
 * `N × max`. Document this in the route's behavior; if you need shared
 * concurrency across replicas, reach for a `@warlock.js/cache` lock instead.
 *
 * @example
 * import { middleware } from "@warlock.js/core";
 *
 * router.post("/reports/generate", reportController, {
 *   middleware: [middleware.concurrencyLimit(3)],
 * });
 *
 * router.post("/ai/summarize", summarizeController, {
 *   middleware: [
 *     middleware.concurrencyLimit(10, {
 *       keyGenerator: (request) => `ai:${request.user?.id ?? request.ip}`,
 *     }),
 *   ],
 * });
 */
export function concurrencyLimitMiddleware(
  max: number,
  options: ConcurrencyLimitOptions = {},
): Middleware {
  return (request, response) => {
    const key = options.keyGenerator?.(request) || request.route.path;
    const current = counters.get(key) || 0;

    if (current >= max) {
      response.header("Retry-After", 1);

      return response.tooManyRequests({
          error: options.errorMessage || t("http.concurrencyLimitReached"),
          errorCode: HttpErrorCodes.ConcurrencyLimitReached,
          limit: max,
        },
      );
    }

    counters.set(key, current + 1);

    let released = false;

    const releaseOnce = () => {
      if (released) {
        return;
      }

      released = true;
      release(key);
    };

    // `onSent` only fires from Response.send()/stream().end()/sse().end().
    // Bare-reply paths (noContent, redirect, sendFile, download, sendBuffer,
    // raw send) never trigger it, so the slot would leak and the route would
    // permanently 429 after `max` such requests. Bind to the raw socket
    // lifecycle as well so the slot frees regardless of response path —
    // `releaseOnce` is idempotent, so double-firing is harmless.
    response.onSent((_sentResponse: Response) => releaseOnce());
    response.baseResponse.raw.once("finish", releaseOnce);
    response.baseResponse.raw.once("close", releaseOnce);
  };
}
