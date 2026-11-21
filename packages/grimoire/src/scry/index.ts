/**
 * `scry`: answers a question about the project from a snapshot, and prints
 * it. The CLI (`warlock scry`), the MCP tools and the devtools tab share it.
 *
 * - `file`: the file's book entry (owner, flows, exports, imports, importers).
 * - `impact`: everything that reaches the file through imports (routes,
 *   pages, flows, features including borrowers, tests).
 * - `route`: a route's handler, guard and the files behind it.
 * - `feature` / `flow`: the written description with its book map.
 * - `search`: a sentence or words over ids, paths, export names, header sentences,
 *   routes, flows, blocks and tasks, ranked by name match first, then BM25F.
 */
export { formatScryResult } from "./format";
export {
  parseApp,
  parseFeatureText,
  parseFlowText,
  parseLimit,
  parseRouteText,
  parseScryQuery,
} from "./parse";
export { scry } from "./query";
export { SCRY_STOP_WORDS } from "./search";
