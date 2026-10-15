/**
 * Sync manager service for handling multi-level sync operations.
 *
 * @module cascade-next/sync/sync-manager
 */
import type { DriverContract } from "../contracts/database-driver.contract";
import { ChildModel, Model } from "../model/model";
import type { SyncConfig, SyncResult } from "./types";
/**
 * Manages sync operations across models with multi-level support.
 */
export declare class SyncManager {
    private readonly sourceModel;
    private readonly driver;
    /**
     * Creates a new sync manager.
     *
     * @param sourceModel - The source model class
     * @param driver - The database driver
     */
    constructor(sourceModel: ChildModel<Model>, driver: DriverContract);
    /**
     * Executes sync operations for a model update.
     *
     * @param sourceId - The source model ID
     * @param updatedData - The updated data to sync (Model instance or plain data)
     * @param changedFields - Fields that were changed (for filtering)
     * @returns Sync result with success status and details
     */
    syncUpdate(sourceId: string | number, updatedData: Record<string, unknown> | Model, changedFields: string[]): Promise<SyncResult>;
    /**
     * Executes sync operations for a model update with a specific config.
     * Used by ModelSyncOperation for event-based sync.
     *
     * @param sourceId - The source model ID
     * @param updatedData - The updated data to sync
     * @param changedFields - Fields that were changed
     * @param config - The sync configuration to use
     * @returns Sync result with success status and details
     */
    syncUpdateWithConfig(sourceId: string | number, updatedData: Record<string, unknown> | Model, changedFields: string[], config: SyncConfig): Promise<SyncResult>;
    /**
     * Executes sync delete operations with a specific config.
     * Used by ModelSyncOperation for event-based sync.
     *
     * @param sourceId - The source model ID
     * @param config - The sync configuration to use
     * @returns Sync result with success status and details
     */
    syncDeleteWithConfig(sourceId: string | number, config: SyncConfig): Promise<SyncResult>;
    /**
     * Executes sync operations for a model deletion.
     *
     * @param sourceId - The source model ID
     * @returns Sync result with success status and details
     */
    syncDelete(sourceId: string | number): Promise<SyncResult>;
    /**
     * Collects sync instructions recursively with depth limiting.
     *
     * @param payload - Data payload
     * @returns Array of sync instructions
     */
    private collectInstructions;
    /**
     * Collects delete sync instructions.
     *
     * @param sourceId - Source model ID
     * @param syncConfigs - Sync configurations
     * @param options - Instruction options
     * @returns Array of sync instructions
     */
    private collectDeleteInstructions;
    /**
     * Collects instructions for the next level in the sync chain.
     *
     * @param parentInstruction - The parent instruction
     * @param embedData - Embedded data from parent
     * @param changedFields - Changed fields
     * @param parentConfig - Parent sync config
     * @param parentOptions - Parent instruction options
     * @returns Array of next-level sync instructions
     */
    private collectNextLevelInstructions;
    /**
     * Builds an update sync instruction.
     *
     * @param sourceId - Source model ID
     * @param config - Sync configuration
     * @param embedData - Embedded data to sync
     * @param options - Instruction options
     * @returns Sync instruction
     */
    private buildUpdateInstruction;
    /**
     * Builds a delete sync instruction.
     *
     * @param sourceId - Source model ID
     * @param config - Sync configuration
     * @param options - Instruction options
     * @returns Sync instruction
     */
    private buildDeleteInstruction;
    /**
     * Builds a filter for identifying target documents.
     *
     * @param sourceId - Source model ID
     * @param config - Sync configuration
     * @returns Filter object
     */
    private buildFilter;
    /**
     * Builds an update operation for syncing data.
     *
     * @param embedData - Embedded data to sync
     * @param config - Sync configuration
     * @returns Update operation object
     */
    private buildUpdate;
    /**
     * Executes sync instructions with batch optimization.
     * Groups by depth and target table for optimal batching.
     *
     * @param instructions - Array of sync instructions
     * @returns Sync result
     */
    private executeInstructions;
    /**
     * Executes instructions in batch.
     *
     * @param instructions - Instructions to execute
     * @param result - Result object to update
     */
    private executeBatch;
    /**
     * Executes instructions individually (fallback).
     * Provides detailed error reporting for each failed instruction.
     *
     * @param instructions - Instructions to execute
     * @param result - Result object to update
     */
    private executeIndividual;
    /**
     * Formats a sync error with detailed context.
     *
     * @param instruction - The failed instruction
     * @param error - The error that occurred
     * @returns Formatted error message
     */
    private formatSyncError;
    /**
     * Groups instructions by depth for batch processing.
     *
     * @param instructions - Instructions to group
     * @returns Map of depth to instructions (sorted ascending)
     */
    private groupByDepth;
    /**
     * Groups instructions by target table for batch optimization.
     *
     * @param instructions - Instructions to group
     * @returns Map of table name to instructions
     */
    private groupByTable;
    /**
     * Checks if sync should proceed based on watched fields.
     *
     * @param config - Sync configuration
     * @param changedFields - Fields that changed
     * @returns True if sync should proceed
     */
    private shouldSync;
    /**
     * Gets embedded data from the source model.
     *
     * @param data - Source model data or Model instance
     * @param config - Sync configuration
     * @returns Embedded data
     */
    private getEmbedData;
    /**
     * Gets sync configurations from the source model.
     *
     * @returns Array of sync configurations
     */
    private getSyncConfigs;
    /**
     * Gets sync configurations for a specific model.
     *
     * @param modelClass - The model class
     * @returns Array of sync configurations
     */
    private getSyncConfigsForModel;
    /**
     * Emits a syncing event.
     *
     * @param instruction - The sync instruction
     */
    private emitSyncingEvent;
    /**
     * Emits a synced event.
     *
     * @param context - The sync context
     */
    private emitSyncedEvent;
    /**
     * Creates an empty sync result.
     *
     * @returns Empty sync result
     */
    private createEmptyResult;
}
//# sourceMappingURL=sync-manager.d.ts.map