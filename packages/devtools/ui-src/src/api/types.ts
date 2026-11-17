/**
 * The API's shapes as the dashboard reads them. Production and shared shapes
 * come from the server's contracts (`src/production/contracts.ts`, imported
 * as `@contracts`, which has no imports of its own). The development payloads
 * that live in `src/types.ts` are restated here where a tab needs them.
 *
 * Owner: WP-6 (add the restated development shapes the tabs need).
 */
export type * from "@contracts";
