import type { ComponentType } from "react";
import type { SerializedErrorPageProps } from "../../hydration-payload";
import { loadClientRouteComposition, type ClientPageEntry } from "../runtime";
import { errorPageComponentOf } from "../runtime/special-page-modules";

/**
 * The CURRENT route's app-owned error page, resolved the same way
 * `build-hydrated-tree.ts` resolves one for a server-selected error render —
 * `loadClientRouteComposition` against the same page registry — so
 * `DefaultErrorBoundary`'s floor prefers the identical component an app
 * author put at `error.page.tsx` for this route. `undefined` for an unknown
 * route name or a route with no error page. A composition that fails to load
 * rejects; `NavigationRoot` treats that the same as "no error page", since
 * the floor already has a safe built-in fallback for it.
 */
export async function resolveErrorPageComponent(
  pages: readonly ClientPageEntry[],
  name: string,
): Promise<ComponentType<SerializedErrorPageProps> | undefined> {
  const entry = pages.find((candidate) => candidate.name === name);

  if (entry === undefined) return undefined;

  // A page behind the on-demand loader comes back as a lazy component: its
  // chunk is fetched when the floor first renders it, not on every navigation.
  return errorPageComponentOf(await loadClientRouteComposition(entry));
}
