import { requestContext } from "@warlock.js/core";

/**
 * The current request's id (core's `request.id`, threaded through
 * `AsyncLocalStorage`), or `undefined` outside a request — sources feed
 * devtools' background bucket in that case.
 *
 * Only ever reached through `./sources/*`, which the connector imports
 * dynamically inside `boot()` — by then core is already running, so this
 * static import never drags core's runtime graph into config-load time (see
 * `devtools-connector.ts`).
 */
export function currentRequestId(): string | undefined {
  try {
    return requestContext.getRequest()?.id;
  } catch {
    return undefined;
  }
}
