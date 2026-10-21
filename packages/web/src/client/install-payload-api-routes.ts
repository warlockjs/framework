import type { HydrationDocumentPayloadSource } from "../hydration-payload";
import { publishNamedApiRoutes } from "../routing/named-api-routes";

/**
 * Publishes the browser route table the payload's page carries
 * (`payload.document.namedApiRoutes`, one table per page document).
 *
 * Runs for the first hydration and for every client navigation, before the
 * page's tree is built, so `apiHref()` and `useSubmitForm({ route })` in the new
 * page resolve against that page's own routes. The table replaces the previous
 * page's: a route only the old page reached is no longer in the table. A payload
 * with no table (a document from a build that predates it) keeps the current one.
 */
export function installPayloadApiRoutes(payload: HydrationDocumentPayloadSource): void {
  const routes = payload.document?.namedApiRoutes;
  if (routes === undefined) return;

  publishNamedApiRoutes(routes);
}
