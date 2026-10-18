import type { Codemod } from "../types";
import { headViewport } from "./head-viewport";
import { loggerSyncCalls } from "./logger-sync-calls";
import { node2215, warlockVersions } from "./package-json";
import { oxcToolchain } from "./oxc-toolchain";
import { requestLogSnapshot } from "./request-log-snapshot";
import {
  aiAnthropicBody,
  aiCompactionOptIn,
  aiFinishReason,
  aiToolDispatch,
  rateLimitDefaults,
  sealContainerCatch,
  sealRefineOutput,
  sealUnionOutput,
  sealValidateResult,
} from "./review-sites";

/**
 * Every codemod, oldest release first. A codemod runs when the app upgrades
 * across its `version` (`from < version <= to`); `"target"` ones run on every
 * upgrade. Add one here for each breaking change, and name its id next to the
 * `**BREAKING**` entry in the package changelog.
 */
export const CODEMODS: readonly Codemod[] = [
  loggerSyncCalls,
  requestLogSnapshot,
  headViewport,
  sealValidateResult,
  aiToolDispatch,
  aiAnthropicBody,
  aiFinishReason,
  node2215,
  rateLimitDefaults,
  sealRefineOutput,
  sealContainerCatch,
  sealUnionOutput,
  aiCompactionOptIn,
  oxcToolchain,
  warlockVersions,
];

export * from "./helpers";
