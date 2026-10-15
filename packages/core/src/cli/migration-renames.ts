export type MigrationRename = {
  from: string;
  to: string;
};

/**
 * Mechanical v5 request-surface renames for the migration CLI.
 */
export const migrationRenames: readonly MigrationRename[] = [
  {
    from: "request.localized",
    to: "request.locale",
  },
  {
    from: "request.getLocaleCode()",
    to: "request.locale",
  },
];
