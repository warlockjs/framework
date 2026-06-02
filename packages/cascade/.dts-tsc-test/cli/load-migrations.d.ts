/**
 * Discover migration files via `fast-glob`, dynamic-import each, and register
 * the default export on `migrationRunner`. Migration name and `createdAt`
 * are inferred from the filename when the class does not declare them.
 *
 * Default glob: `./migrations/&#42;&#42;/&#42;.{ts,js,mjs,cjs}` from `process.cwd()`.
 * Pass an explicit pattern to override.
 *
 * @returns Number of migration files registered.
 *
 * @example
 * await loadMigrations();
 * await loadMigrations("./db/schema/&#42;.migration.js");
 */
export declare function loadMigrations(pattern?: string): Promise<number>;
//# sourceMappingURL=load-migrations.d.ts.map