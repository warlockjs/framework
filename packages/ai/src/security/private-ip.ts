/**
 * Compatibility export for the shared core SSRF classifier. Keeping this
 * AI-facing path avoids a breaking change for existing consumers while both
 * AI outbound policy checks and core storage checks use identical IP rules.
 *
 * Imported from the side-effect-free `@warlock.js/core/net` subpath, never
 * the Core root, so a standalone agent process does not load Core's HTTP
 * server, database or cache modules (`core-import-graph.spec.ts` guards it).
 */
export { isPrivateOrReservedIp } from "@warlock.js/core/net";
