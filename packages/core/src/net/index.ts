/**
 * `@warlock.js/core/net` — Core's network helpers on their own.
 *
 * A separate, side-effect-free entry: importing it loads only the IP
 * classifier (and Node's `node:net`), never the application runtime behind
 * the root barrel (the HTTP server, Cascade, Cache, the MongoDB driver, the
 * mail and React modules). A standalone process — an agent runner built on
 * `@warlock.js/ai`, a worker, a CLI — can guard outbound requests against
 * private addresses and bundle without the framework.
 *
 * The functions are the same ones the root `@warlock.js/core` exports, so
 * both entries apply identical rules.
 *
 * Keep this graph free of package imports: `net-entry.spec.ts` fails the
 * moment anything reachable from here imports a package other than a Node
 * built-in.
 */
export { isPrivateOrReservedIp } from "../storage/utils/classify-ip-address";
