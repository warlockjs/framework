import type { SqlDialectContract } from "../sql/sql-dialect.contract";
import type { PendingOperation } from "../../migration/migration";
import { SQLSerializer } from "../../migration/sql-serializer";
/**
 * PostgreSQL-specific SQL serializer.
 *
 * Converts pending migration operations into valid PostgreSQL DDL statements.
 */
export declare class PostgresSQLSerializer extends SQLSerializer {
    private readonly dialect;
    constructor(dialect: SqlDialectContract);
    serialize(operation: PendingOperation, table: string): string | string[] | null;
    private createTable;
    private createTableIfNotExists;
    private dropTable;
    private dropTableIfExists;
    private renameTable;
    private truncateTable;
    private addColumn;
    private dropColumn;
    private dropColumns;
    private renameColumn;
    private modifyColumn;
    private createTimestamps;
    private createIndex;
    private dropIndex;
    private createFullTextIndex;
    private createGeoIndex;
    private createVectorIndex;
    private createTTLIndex;
    private addForeignKey;
    private dropForeignKey;
    private addPrimaryKey;
    private dropPrimaryKey;
    private mapForeignKeyAction;
}
//# sourceMappingURL=postgres-sql-serializer.d.ts.map