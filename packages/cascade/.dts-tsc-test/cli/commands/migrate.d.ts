/**
 * `cascade migrate` — run all pending migrations against the configured
 * data source. With `--fresh` rolls back everything first and re-runs;
 * with `--sql` writes phase-ordered SQL files instead of executing.
 */
export declare const migrateCommand: import("citty").CommandDef<{
    readonly fresh: {
        readonly type: "boolean";
        readonly alias: "f";
        readonly description: "Roll back every executed migration first, then run them again.";
        readonly default: false;
    };
    readonly sql: {
        readonly type: "boolean";
        readonly alias: "s";
        readonly description: "Export migrations to phase-ordered SQL files instead of executing.";
        readonly default: false;
    };
    readonly "pending-only": {
        readonly type: "boolean";
        readonly description: "When used with --sql, export only pending migrations.";
        readonly default: false;
    };
    readonly compact: {
        readonly type: "boolean";
        readonly alias: "c";
        readonly description: "When used with --sql, strip generated comments and blank lines.";
        readonly default: false;
    };
    readonly path: {
        readonly type: "string";
        readonly alias: "p";
        readonly description: "Glob pattern overriding the default ./migrations/**/*.{ts,js,mjs,cjs}.";
    };
}>;
//# sourceMappingURL=migrate.d.ts.map