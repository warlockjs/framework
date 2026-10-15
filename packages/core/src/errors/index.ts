/**
 * `@warlock.js/core/errors` — Core's HTTP error classes on their own.
 *
 * A separate, side-effect-free entry: importing it loads only the error
 * classes, never the application runtime behind the root barrel (Cascade,
 * Cache, the MongoDB driver, the HTTP server). A standalone helper, worker or
 * CLI can throw `BadRequestError` and bundle without the framework.
 *
 * The classes are the same ones the root `@warlock.js/core` exports, so
 * `instanceof HttpError` holds whichever entry the error came from.
 *
 * Keep this graph free of imports: `errors-entry.spec.ts` fails the moment
 * anything reachable from here imports a package or a module with side effects.
 */
export * from "../http/errors/errors";
