import type { SQLStatementType, TaggedSQL } from "./types";
/**
 * Parses and sorts SQL statements globally based on their execution phase,
 * and classifies statements by their semantic type.
 */
export declare class SQLGrammar {
    /**
     * Determine the execution phase of a SQL statement (1–6).
     *
     * Phase ordering ensures DDL operations run in dependency-safe order
     * regardless of which migration file they originate from.
     *
     * | Phase | Statements                                    |
     * |-------|-----------------------------------------------|
     * | 1     | CREATE EXTENSION, TYPE, DOMAIN, SCHEMA        |
     * | 2     | CREATE TABLE                                  |
     * | 3     | ADD COLUMN, ADD PRIMARY KEY                   |
     * | 4     | CREATE INDEX, ADD FOREIGN KEY                 |
     * | 5     | DROP COLUMN, ALTER COLUMN, DROP TABLE         |
     * | 6     | Raw / unclassified                            |
     *
     * @example
     * SQLGrammar.phase("CREATE EXTENSION IF NOT EXISTS vector"); // => 1
     * SQLGrammar.phase("ALTER TABLE users ADD COLUMN email TEXT"); // => 3
     */
    static phase(sql: string): 1 | 2 | 3 | 4 | 5 | 6;
    /**
     * Classify a SQL statement into its semantic statement type.
     *
     * This is independent of execution phase — it identifies *what* a statement
     * does, not *when* it should run. Use this for pre-flight checks, dry-run
     * display, selective filtering, and extension detection.
     *
     * @example
     * SQLGrammar.classify("CREATE EXTENSION IF NOT EXISTS vector");
     * // => "CREATE_EXTENSION"
     *
     * SQLGrammar.classify("ALTER TABLE users ADD COLUMN email TEXT");
     * // => "ADD_COLUMN"
     */
    static classify(sql: string): SQLStatementType;
    /**
     * Extract the extension name from a CREATE EXTENSION statement.
     *
     * Returns undefined if the statement is not a CREATE EXTENSION statement
     * or the name cannot be parsed.
     *
     * @example
     * SQLGrammar.extractExtensionName("CREATE EXTENSION IF NOT EXISTS vector");
     * // => "vector"
     *
     * SQLGrammar.extractExtensionName("CREATE EXTENSION postgis");
     * // => "postgis"
     */
    static extractExtensionName(sql: string): string | undefined;
    /**
     * Sort an array of tagged SQL statements by phase, then creation date, then migration name.
     */
    static sort(statements: TaggedSQL[]): TaggedSQL[];
}
//# sourceMappingURL=sql-grammar.d.ts.map