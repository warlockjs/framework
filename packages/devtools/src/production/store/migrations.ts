/**
 * The migrations of the production monitor's tables/collections:
 * `devtools_accounts`, `devtools_sessions`, `devtools_invites`,
 * `devtools_audit`, `devtools_state`, `devtools_samples`, `devtools_reports`.
 * An app lists them in `warlock.config.ts > database.migrations`.
 *
 * Owner: WP-1 (fills this list with the cascade `migrate()` results).
 */
export const devtoolsMigrations: readonly unknown[] = [];
