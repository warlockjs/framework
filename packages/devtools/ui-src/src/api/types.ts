/**
 * The API's shapes as the dashboard reads them. Production and shared shapes
 * come from the server's contracts (`src/production/contracts.ts`, imported
 * as `@contracts`, which has no imports of its own). The development payloads
 * that live in `src/types.ts` are restated here where a tab needs them.
 */
import type { DevtoolsAuthStepResult } from "@contracts";

export type * from "@contracts";

/** A sign-in step answer that may carry recovery codes (the first factor was just confirmed). */
export type AuthStepWithCodes = DevtoolsAuthStepResult & { recoveryCodes?: string[] };
