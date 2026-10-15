/**
 * Root command for the standalone `cascade` CLI binary. Scope is restricted
 * to migration operations — database management (`db:create` etc.) stays in
 * the warlock-core CLI where the project context is available.
 *
 * Subcommands follow colon-style naming (`cascade migrate:list`) so each
 * verb stays addressable as a single argv token.
 */
export declare const main: import("citty").CommandDef<import("citty").ArgsDef>;
//# sourceMappingURL=index.d.ts.map