/**
 * The dev-mode diagnostic for dynamic routes {@link collectSitemapEntries}
 * (`collect-entries.ts`) could not enumerate — the whole reason this package
 * is written carefully. A dynamic route cannot be enumerated without
 * application data; what the framework controls is whether the developer
 * finds out. Returns `undefined` when there is nothing to report, so a caller
 * can `if (message) console.warn(message)` without an extra length check.
 */
export function describeUnresolvedDynamicRoutes(routeNames: readonly string[]): string | undefined {
  if (routeNames.length === 0) return undefined;

  const plural = routeNames.length === 1 ? "" : "s";
  const named = routeNames.map((name) => `  - ${name}`).join("\n");

  return (
    `[warlock:sitemap] ${routeNames.length} dynamic route${plural} ` +
    `${routeNames.length === 1 ? "has" : "have"} no \`sitemap\` export and ` +
    `${routeNames.length === 1 ? "is" : "are"} OMITTED from sitemap.xml:\n${named}\n` +
    "A dynamic route cannot be enumerated without application data. Add " +
    "`export const sitemap: SitemapEntries = async () => [...]` to each page above, " +
    "or `export const sitemap = false` to keep it out of the sitemap deliberately."
  );
}
