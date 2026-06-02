/**
 * `cascade migrate:export-sql` — write phase-ordered `.up.sql` /
 * `.down.sql` files for the registered migrations under
 * `<cwd>/database/sql/`. No DB writes occur.
 */
export declare const migrateExportSqlCommand: import("citty").CommandDef<{
    readonly "pending-only": {
        readonly type: "boolean";
        readonly description: "Export only pending migrations.";
        readonly default: false;
    };
    readonly compact: {
        readonly type: "boolean";
        readonly alias: "c";
        readonly description: "Strip generated comments and blank lines.";
        readonly default: false;
    };
    readonly path: {
        readonly type: "string";
        readonly alias: "p";
        readonly description: "Glob pattern overriding the default ./migrations/**/*.{ts,js,mjs,cjs}.";
    };
}>;
//# sourceMappingURL=migrate-export-sql.d.ts.map