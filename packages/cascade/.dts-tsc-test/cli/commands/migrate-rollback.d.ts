/**
 * `cascade migrate:rollback` — undo the most recent batch (or every executed
 * migration with `--all`). Migration files are loaded so the runner has the
 * `down()` methods available.
 */
export declare const migrateRollbackCommand: import("citty").CommandDef<{
    readonly all: {
        readonly type: "boolean";
        readonly alias: "a";
        readonly description: "Roll back every executed migration. Overrides --batches.";
        readonly default: false;
    };
    readonly batches: {
        readonly type: "string";
        readonly description: "Roll back the last N batches (ignored when --all is set). Default: 1.";
    };
    readonly path: {
        readonly type: "string";
        readonly alias: "p";
        readonly description: "Glob pattern overriding the default ./migrations/**/*.{ts,js,mjs,cjs}.";
    };
}>;
//# sourceMappingURL=migrate-rollback.d.ts.map