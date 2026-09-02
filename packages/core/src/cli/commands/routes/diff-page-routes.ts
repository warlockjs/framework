/**
 * The comparison half of `warlock routes:diff`, kept free of the filesystem,
 * the boot and the console so it can be exercised directly.
 *
 * WHAT THE TWO SIDES ACTUALLY ARE
 *
 * `expected` comes from `page-routes.manifest.json`, which `warlock build`
 * writes from a pure FILESYSTEM SCAN of the page graph. No application module
 * is imported, no connector boots, no route is registered.
 *
 * `live` comes from the running router, after real registration.
 *
 * Every difference between the two that is NOT drift has to be removed on the
 * producing side, so this comparison can stay a strict string equality — see
 * `normalizeRoutePath` for the path half. Exactly one property survives that
 * rule and is handled here instead, because it is genuinely unknowable at
 * build time: the route-name method suffix (below).
 */
import { matchesDerivedRouteName } from "../../../router/route-name-method-suffix";

export type PageRoute = {
  method: "GET";
  path: string;
  name: string;
  source: string;
};

export type PageRouteChange = {
  before: PageRoute;
  after: PageRoute;
};

export type PageRoutesDiff = {
  changes: PageRouteChange[];
  removed: PageRoute[];
  added: PageRoute[];
};

/** Stable ordering for printed output: by path, then by name. */
export function comparePageRoutes(left: PageRoute, right: PageRoute): number {
  return left.path.localeCompare(right.path) || left.name.localeCompare(right.name);
}

/**
 * Whether a live route is the same route the build recorded.
 *
 * Method and path must match EXACTLY. The name is compared derived-to-derived:
 * the router appends `.<method>` to a name already claimed by a route of
 * another method (`Router.add`), and which routes get that suffix depends on
 * the registration order across the whole route set — pages and API routes
 * alike. `warlock build` never boots connectors, so the manifest cannot see the
 * API routes that cause the collision and can never record the suffix.
 *
 * Ignoring it here is therefore not leniency, it is reading the manifest for
 * what it is: a record of what each page's name was DERIVED as, not of what it
 * was REGISTERED as. `matchesDerivedRouteName` accepts only the one suffix the
 * router itself could have appended; any other name difference is still drift.
 *
 * THE LIMIT THIS BUYS: a clean diff does not prove that no page name collided
 * at registration. Use `warlock routes` to see the names as registered.
 */
function isSameRoute(expected: PageRoute, live: PageRoute): boolean {
  return (
    live.method === expected.method &&
    live.path === expected.path &&
    matchesDerivedRouteName(expected.name, live.name, live.method)
  );
}

/**
 * Diff the build-time page route surface against the live one.
 *
 * Neither input is mutated and neither has to be pre-sorted; the returned lists
 * are sorted for printing.
 */
export function diffPageRoutes(expected: PageRoute[], live: PageRoute[]): PageRoutesDiff {
  const remainingExpected = new Set(expected);
  const remainingLive = new Set(live);
  const changes: PageRouteChange[] = [];

  // Route identity is the comparison contract. A differing source is displayed
  // only as context and must not make an otherwise identical route drift (a
  // checkout can be relocated without changing its surface).
  for (const before of expected) {
    const after = [...remainingLive].find((candidate) => isSameRoute(before, candidate));

    if (after) {
      remainingExpected.delete(before);
      remainingLive.delete(after);
    }
  }

  // A stable source is diagnostic context, never itself a diff. It only groups
  // a changed page into one useful line instead of a removal plus an addition.
  for (const before of remainingExpected) {
    const after = [...remainingLive].find(
      (candidate) => candidate.source !== "" && candidate.source === before.source,
    );

    if (after && !isSameRoute(before, after)) {
      changes.push({ before, after });
      remainingExpected.delete(before);
      remainingLive.delete(after);
    }
  }

  return {
    changes: changes.sort((left, right) => comparePageRoutes(left.before, right.before)),
    removed: [...remainingExpected].sort(comparePageRoutes),
    added: [...remainingLive].sort(comparePageRoutes),
  };
}
