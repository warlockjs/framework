import type { Db, IndexDescriptionInfo } from "mongodb";
import { DriverBlueprintContract, TableIndexInformation } from "../../contracts/driver-blueprint.contract";
export declare class MongoDBBlueprint implements DriverBlueprintContract {
    protected database: Db;
    /**
     * Constructor
     */
    constructor(database: Db);
    /**
     * List all tables in the database
     */
    listTables(): Promise<string[]>;
    /**
     * List all indexes for a specific table
     */
    listIndexes(table: string): Promise<TableIndexInformation[]>;
    /**
     * Build index information
     */
    protected buildIndexInformation(index: IndexDescriptionInfo): TableIndexInformation;
    /**
     * List all columns for a specific table
     */
    listColumns(table: string): Promise<string[]>;
    /**
     * Check if the given table exists
     */
    tableExists(table: string): Promise<boolean>;
}
//# sourceMappingURL=mongodb-blueprint.d.ts.map