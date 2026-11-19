import type { MigrationConstructor } from "@warlock.js/cascade";
import {
  DevtoolsAccountsMigration,
  DevtoolsAiRollupsMigration,
  DevtoolsAuditMigration,
  DevtoolsInvitesMigration,
  DevtoolsReportsMigration,
  DevtoolsSamplesMigration,
  DevtoolsSessionsMigration,
  DevtoolsSharesMigration,
  DevtoolsStateMigration,
} from "./models";

/**
 * The migrations of the production monitor's tables/collections:
 * `devtools_accounts`, `devtools_sessions`, `devtools_invites`,
 * `devtools_audit`, `devtools_state`, `devtools_samples`, `devtools_reports`,
 * `devtools_shares`, `devtools_ai_rollups`.
 * An app lists them in `warlock.config.ts > database.migrations`.
 */
export const devtoolsMigrations: readonly MigrationConstructor[] = [
  DevtoolsAccountsMigration,
  DevtoolsSessionsMigration,
  DevtoolsInvitesMigration,
  DevtoolsAuditMigration,
  DevtoolsStateMigration,
  DevtoolsSamplesMigration,
  DevtoolsReportsMigration,
  DevtoolsSharesMigration,
  DevtoolsAiRollupsMigration,
];
