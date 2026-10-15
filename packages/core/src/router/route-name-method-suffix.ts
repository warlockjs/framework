/**
 * The route-name suffix the router appends at REGISTRATION time, and its
 * inverse.
 *
 * `Router.add` gives a route the name it was asked for — unless another route
 * already claimed that name under a DIFFERENT method, in which case it appends
 * `.<method>` so both can coexist. That decision depends on the whole
 * registration order across pages AND API routes, so it cannot be predicted by
 * anything that only looks at one route, or at only one kind of route.
 *
 * Both halves live here so the rule is written down once: `Router.add` builds
 * the suffix with {@link routeNameMethodSuffix}, and anything comparing a
 * DERIVED name against a REGISTERED one uses {@link matchesDerivedRouteName}.
 */

/**
 * The suffix `Router.add` appends to a route name already claimed by another
 * method.
 */
export function routeNameMethodSuffix(method: string): string {
  return `.${method.toLowerCase()}`;
}

/**
 * Whether `registeredName` is what the router would have registered for a
 * route whose name was DERIVED as `derivedName`.
 *
 * True for exactly two spellings: the derived name itself, and the derived
 * name plus the registration collision suffix for `method`. It is not a fuzzy
 * match — a `.get` suffix is accepted only where the router itself could have
 * added one, and any other difference is still a difference.
 */
export function matchesDerivedRouteName(
  derivedName: string,
  registeredName: string,
  method: string,
): boolean {
  if (registeredName === derivedName) {
    return true;
  }

  return registeredName === derivedName + routeNameMethodSuffix(method);
}
