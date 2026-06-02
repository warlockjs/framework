import { ConnectorName } from "../connectors/types.mjs";
//#region ../../@warlock.js/core/src/tests/vitest-setup.d.ts
type TestSetup = {
  connectors?: boolean | ConnectorName[];
};
/**
 * Setup function that runs once per worker thread
 */
declare function setupTest({
  connectors
}: TestSetup): Promise<void>;
//#endregion
export { setupTest };
//# sourceMappingURL=vitest-setup.d.mts.map