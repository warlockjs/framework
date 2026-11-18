import type { FastifyRequest } from "fastify";
import type { DevtoolsAuthenticated, DevtoolsRequestMeta } from "../auth/types";
import type { DevtoolsShareGrant } from "./share-session";
import type { DevtoolsClientInfo, DevtoolsRouteAccessRule } from "./types";

/** What the gate learned about a dashboard request, for the handlers that follow. */
export type DevtoolsRequestContext = {
  client: DevtoolsClientInfo;
  meta: DevtoolsRequestMeta;
  /** The access rule the route matched; `undefined` for a route with no entry (treated as admin). */
  rule: DevtoolsRouteAccessRule | undefined;
  /** The route pattern relative to the dashboard path (`/api/requests/:id`). */
  pattern: string;
  /** The session, for every route that is not public. */
  authenticated: DevtoolsAuthenticated | null;
  /** The share grant, for a request that passed the `share` access check. */
  share?: DevtoolsShareGrant | null;
};

const contexts = new WeakMap<FastifyRequest, DevtoolsRequestContext>();

/** Stores the context of `request` (the gate calls this). */
export function setDevtoolsRequestContext(
  request: FastifyRequest,
  context: DevtoolsRequestContext,
): void {
  contexts.set(request, context);
}

/** The context the gate stored for `request`, or `undefined` outside the production dashboard. */
export function devtoolsRequestContext(
  request: FastifyRequest,
): DevtoolsRequestContext | undefined {
  return contexts.get(request);
}
