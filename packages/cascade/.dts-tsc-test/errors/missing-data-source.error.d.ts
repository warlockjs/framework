/**
 * Error thrown when a requested data source is not found in the registry.
 *
 * This can occur when:
 * - Attempting to retrieve a non-existent named data source
 * - Trying to get the default data source before any have been registered
 * - Context override references an unregistered data source name
 */
export declare class MissingDataSourceError extends Error {
    /**
     * The name of the data source that was not found (if applicable).
     */
    readonly dataSourceName?: string;
    /**
     * Creates a new MissingDataSourceError.
     *
     * @param message - Descriptive error message
     * @param dataSourceName - Optional data source name that was not found
     */
    constructor(message: string, dataSourceName?: string);
}
//# sourceMappingURL=missing-data-source.error.d.ts.map