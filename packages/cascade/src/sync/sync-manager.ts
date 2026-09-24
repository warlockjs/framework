/**
 * Sync manager service for handling multi-level sync operations.
 *
 * @module cascade-next/sync/sync-manager
 */

import type { DriverContract } from "../contracts/database-driver.contract";
import { type ChildModel, Model } from "../model/model";
import { DEFAULT_MAX_SYNC_DEPTH, SyncContextManager } from "./sync-context";
import type {
  CollectInstructionsPayload,
  SyncConfig,
  SyncEventPayload,
  SyncInstruction,
  SyncInstructionOptions,
  SyncResult,
} from "./types";

/**
 * Manages sync operations across models with multi-level support.
 */
export class SyncManager {
  private readonly sourceModel: ChildModel<Model>;
  private readonly driver: DriverContract;

  /**
   * Creates a new sync manager.
   *
   * @param sourceModel - The source model class
   * @param driver - The database driver
   */
  public constructor(sourceModel: ChildModel<Model>, driver: DriverContract) {
    this.sourceModel = sourceModel;
    this.driver = driver;
  }

  /**
   * Executes sync operations for a model update.
   *
   * @param sourceId - The source model ID
   * @param updatedData - The updated data to sync (Model instance or plain data)
   * @param changedFields - Fields that were changed (for filtering)
   * @returns Sync result with success status and details
   */
  public async syncUpdate(
    sourceId: string | number,
    updatedData: Record<string, unknown> | Model,
    changedFields: string[],
  ): Promise<SyncResult> {
    try {
      const syncConfigs = this.getSyncConfigs();

      if (syncConfigs.length === 0) {
        return this.createEmptyResult();
      }

      const options: SyncInstructionOptions = {
        currentDepth: 1,
        syncChain: [this.sourceModel.name],
        maxDepth: DEFAULT_MAX_SYNC_DEPTH,
        preventCircular: true,
      };

      const instructions = await this.collectInstructions({
        sourceId,
        updatedData,
        changedFields,
        syncConfigs,
        options,
      });

      return await this.executeInstructions(instructions);
    } catch (error) {
      // Catch-all error handler for unexpected failures
      console.error(`Sync update failed for ${this.sourceModel.name}#${sourceId}:`, error);

      return {
        success: false,
        attempted: 0,
        succeeded: 0,
        failed: 1,
        errors: [
          {
            instruction: {
              targetTable: "",
              targetModel: "",
              filter: {},
              update: {},
              depth: 0,
              chain: [this.sourceModel.name],
              sourceModel: this.sourceModel.name,
              sourceId,
            },
            error: error instanceof Error ? error : new Error(String(error)),
          },
        ],
        depthReached: 0,
        contexts: [],
      };
    }
  }

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
  public async syncUpdateWithConfig(
    sourceId: string | number,
    updatedData: Record<string, unknown> | Model,
    changedFields: string[],
    config: SyncConfig,
  ): Promise<SyncResult> {
    try {
      const options: SyncInstructionOptions = {
        currentDepth: 1,
        syncChain: [this.sourceModel.name],
        maxDepth: config.maxSyncDepth,
        preventCircular: config.preventCircularSync,
      };

      const instructions = await this.collectInstructions({
        sourceId,
        updatedData,
        changedFields,
        syncConfigs: [config],
        options,
      });

      return await this.executeInstructions(instructions);
    } catch (error) {
      console.error(
        `Sync update with config failed for ${this.sourceModel.name}#${sourceId}:`,
        error,
      );

      return {
        success: false,
        attempted: 0,
        succeeded: 0,
        failed: 1,
        errors: [
          {
            instruction: {
              targetTable: "",
              targetModel: "",
              filter: {},
              update: {},
              depth: 0,
              chain: [this.sourceModel.name],
              sourceModel: this.sourceModel.name,
              sourceId,
            },
            error: error instanceof Error ? error : new Error(String(error)),
          },
        ],
        depthReached: 0,
        contexts: [],
      };
    }
  }

  /**
   * Executes sync delete operations with a specific config.
   * Used by ModelSyncOperation for event-based sync.
   *
   * @param sourceId - The source model ID
   * @param config - The sync configuration to use
   * @returns Sync result with success status and details
   */
  public async syncDeleteWithConfig(
    sourceId: string | number,
    config: SyncConfig,
  ): Promise<SyncResult> {
    try {
      if (!config.unsetOnDelete) {
        return this.createEmptyResult();
      }

      const options: SyncInstructionOptions = {
        currentDepth: 1,
        syncChain: [this.sourceModel.name],
        maxDepth: config.maxSyncDepth,
        preventCircular: config.preventCircularSync,
      };

      const instructions = await this.collectDeleteInstructions(sourceId, [config], options);

      return await this.executeInstructions(instructions);
    } catch (error) {
      console.error(
        `Sync delete with config failed for ${this.sourceModel.name}#${sourceId}:`,
        error,
      );

      return {
        success: false,
        attempted: 0,
        succeeded: 0,
        failed: 1,
        errors: [
          {
            instruction: {
              targetTable: "",
              targetModel: "",
              filter: {},
              update: {},
              depth: 0,
              chain: [this.sourceModel.name],
              sourceModel: this.sourceModel.name,
              sourceId,
            },
            error: error instanceof Error ? error : new Error(String(error)),
          },
        ],
        depthReached: 0,
        contexts: [],
      };
    }
  }

  /**
   * Executes sync operations for a model deletion.
   *
   * @param sourceId - The source model ID
   * @returns Sync result with success status and details
   */
  public async syncDelete(sourceId: string | number): Promise<SyncResult> {
    try {
      const syncConfigs = this.getSyncConfigs();

      if (syncConfigs.length === 0) {
        return this.createEmptyResult();
      }

      const options: SyncInstructionOptions = {
        currentDepth: 1,
        syncChain: [this.sourceModel.name],
        maxDepth: DEFAULT_MAX_SYNC_DEPTH,
        preventCircular: true,
      };

      const instructions = await this.collectDeleteInstructions(sourceId, syncConfigs, options);

      return await this.executeInstructions(instructions);
    } catch (error) {
      // Catch-all error handler for unexpected failures
      console.error(`Sync delete failed for ${this.sourceModel.name}#${sourceId}:`, error);

      return {
        success: false,
        attempted: 0,
        succeeded: 0,
        failed: 1,
        errors: [
          {
            instruction: {
              targetTable: "",
              targetModel: "",
              filter: {},
              update: {},
              depth: 0,
              chain: [this.sourceModel.name],
              sourceModel: this.sourceModel.name,
              sourceId,
            },
            error: error instanceof Error ? error : new Error(String(error)),
          },
        ],
        depthReached: 0,
        contexts: [],
      };
    }
  }

  /**
   * Collects sync instructions recursively with depth limiting.
   *
   * @param payload - Data payload
   * @returns Array of sync instructions
   */
  private async collectInstructions(
    payload: CollectInstructionsPayload,
  ): Promise<SyncInstruction[]> {
    const { sourceId, updatedData, changedFields, syncConfigs, options } = payload;
    const instructions: SyncInstruction[] = [];

    for (const config of syncConfigs) {
      // Check if we should sync based on watched fields
      if (!this.shouldSync(config, changedFields)) {
        continue;
      }

      // Validate depth and circular references
      const validation = SyncContextManager.validate(
        options.currentDepth,
        options.syncChain,
        config.targetModelClass.name,
        config.maxSyncDepth,
        config.preventCircularSync,
      );

      if (!validation.valid) {
        console.warn(`Sync validation failed: ${validation.error}`);
        continue;
      }

      // Get embedded data (handle both Model instance and plain data)
      const embedData = await this.getEmbedData(updatedData, config);

      // Build instruction
      const instruction = this.buildUpdateInstruction(sourceId, config, embedData, options);

      instructions.push(instruction);

      // Emit syncing event
      await this.emitSyncingEvent(instruction);

    }

    return instructions;
  }

  /**
   * Collects delete sync instructions.
   *
   * @param sourceId - Source model ID
   * @param syncConfigs - Sync configurations
   * @param options - Instruction options
   * @returns Array of sync instructions
   */
  private async collectDeleteInstructions(
    sourceId: string | number,
    syncConfigs: SyncConfig[],
    options: SyncInstructionOptions,
  ): Promise<SyncInstruction[]> {
    const instructions: SyncInstruction[] = [];

    for (const config of syncConfigs) {
      if (!config.unsetOnDelete) {
        continue;
      }

      const validation = SyncContextManager.validate(
        options.currentDepth,
        options.syncChain,
        config.targetModelClass.name,
        config.maxSyncDepth,
        config.preventCircularSync,
      );

      if (!validation.valid) {
        continue;
      }

      const instruction = this.buildDeleteInstruction(sourceId, config, options);
      instructions.push(instruction);

      await this.emitSyncingEvent(instruction);
    }

    return instructions;
  }

  /**
   * Builds an update sync instruction.
   *
   * @param sourceId - Source model ID
   * @param config - Sync configuration
   * @param embedData - Embedded data to sync
   * @param options - Instruction options
   * @returns Sync instruction
   */
  private buildUpdateInstruction(
    sourceId: string | number,
    config: SyncConfig,
    embedData: Record<string, unknown>,
    options: SyncInstructionOptions,
  ): SyncInstruction {
    const targetModelClass = config.targetModelClass;
    const filter = this.buildFilter(sourceId, config);
    const update = this.buildUpdate(embedData, config);

    const instruction: SyncInstruction = {
      targetTable: targetModelClass.table,
      targetModel: targetModelClass.name,
      filter,
      update,
      depth: options.currentDepth,
      chain: [...options.syncChain],
      sourceModel: this.sourceModel.name,
      sourceId,
    };

    // Add array update metadata if needed
    if (config.isMany) {
      instruction.isArrayUpdate = true;
      instruction.arrayField = config.targetField;
      instruction.identifierField = config.identifierField;
      instruction.identifierValue = sourceId;
    }

    return instruction;
  }

  /**
   * Builds a delete sync instruction.
   *
   * @param sourceId - Source model ID
   * @param config - Sync configuration
   * @param options - Instruction options
   * @returns Sync instruction
   */
  private buildDeleteInstruction(
    sourceId: string | number,
    config: SyncConfig,
    options: SyncInstructionOptions,
  ): SyncInstruction {
    const targetModelClass = config.targetModelClass;
    const filter = this.buildFilter(sourceId, config);
    // For arrays, remove only the deleted element instead of wiping the whole field
    const update = config.isMany
      ? { $pull: { [config.targetField]: { [config.identifierField]: sourceId } } }
      : { $unset: { [config.targetField]: 1 } };

    return {
      targetTable: targetModelClass.table,
      targetModel: targetModelClass.name,
      filter,
      update,
      depth: options.currentDepth,
      chain: [...options.syncChain],
      sourceModel: this.sourceModel.name,
      sourceId,
    };
  }

  /**
   * Builds a filter for identifying target documents.
   *
   * @param sourceId - Source model ID
   * @param config - Sync configuration
   * @returns Filter object
   */
  private buildFilter(sourceId: string | number, config: SyncConfig): Record<string, unknown> {
    if (config.isMany) {
      // For arrays: { "products.id": productId }
      return { [`${config.targetField}.${config.identifierField}`]: sourceId };
    } else {
      // For single: { "category.id": categoryId }
      return { [`${config.targetField}.${config.identifierField}`]: sourceId };
    }
  }

  /**
   * Builds an update operation for syncing data.
   *
   * @param embedData - Embedded data to sync
   * @param config - Sync configuration
   * @returns Update operation object
   */
  private buildUpdate(
    embedData: Record<string, unknown>,
    config: SyncConfig,
  ): Record<string, unknown> {
    if (config.isMany) {
      // For arrays: use positional operator $
      return { $set: { [`${config.targetField}.$`]: embedData } };
    } else {
      // For single: direct set
      return { $set: { [config.targetField]: embedData } };
    }
  }

  /**
   * Executes sync instructions, once each, through the driver's dialect-aware
   * sync adapter. Instructions run in depth order and each one records its own
   * outcome, so one failing instruction never re-runs the ones that succeeded.
   *
   * @param instructions - Array of sync instructions
   * @returns Sync result
   */
  private async executeInstructions(instructions: SyncInstruction[]): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      attempted: instructions.length,
      succeeded: 0,
      failed: 0,
      errors: [],
      depthReached: 0,
      contexts: [],
    };

    if (instructions.length === 0) {
      return result;
    }

    const adapter = this.driver.syncAdapter();

    for (const [depth, depthInstructions] of this.groupByDepth(instructions)) {
      result.depthReached = Math.max(result.depthReached, depth);

      for (const instruction of depthInstructions) {
        try {
          const affected = await adapter.executeBatch([instruction]);

          const context = SyncContextManager.createContext(instruction, affected);
          result.contexts.push(context);
          result.succeeded++;

          await this.emitSyncedEvent(context);
        } catch (error) {
          result.failed++;

          const errorMessage = this.formatSyncError(instruction, error);
          const syncError = new Error(errorMessage);

          // Preserve original error stack if available
          if (error instanceof Error && error.stack) {
            syncError.stack = error.stack;
          }

          result.errors.push({ instruction, error: syncError });

          console.error(`Sync operation failed:`, {
            sourceModel: instruction.sourceModel,
            sourceId: instruction.sourceId,
            targetModel: instruction.targetModel,
            targetTable: instruction.targetTable,
            depth: instruction.depth,
            chain: SyncContextManager.formatChain(instruction.chain),
            filter: instruction.filter,
            error: errorMessage,
          });
        }
      }
    }

    result.success = result.failed === 0;
    return result;
  }

  /**
   * Formats a sync error with detailed context.
   *
   * @param instruction - The failed instruction
   * @param error - The error that occurred
   * @returns Formatted error message
   */
  private formatSyncError(instruction: SyncInstruction, error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const chain = SyncContextManager.formatChain(instruction.chain);

    return [
      `Sync failed at depth ${instruction.depth}:`,
      `Chain: ${chain} → ${instruction.targetModel}`,
      `Source: ${instruction.sourceModel}#${instruction.sourceId}`,
      `Target: ${instruction.targetTable}`,
      `Error: ${baseMessage}`,
    ].join(" | ");
  }

  /**
   * Groups instructions by depth for batch processing.
   *
   * @param instructions - Instructions to group
   * @returns Map of depth to instructions (sorted ascending)
   */
  private groupByDepth(instructions: SyncInstruction[]): Map<number, SyncInstruction[]> {
    const grouped = new Map<number, SyncInstruction[]>();

    for (const instruction of instructions) {
      const depth = instruction.depth;
      if (!grouped.has(depth)) {
        grouped.set(depth, []);
      }
      grouped.get(depth)!.push(instruction);
    }

    // Sort by depth (ascending) for sequential execution
    return new Map([...grouped.entries()].sort((a, b) => a[0] - b[0]));
  }

  /**
   * Checks if sync should proceed based on watched fields.
   *
   * @param config - Sync configuration
   * @param changedFields - Fields that changed
   * @returns True if sync should proceed
   */
  private shouldSync(config: SyncConfig, changedFields: string[]): boolean {
    if (config.watchFields.length === 0) {
      return true; // Watch all fields
    }

    return config.watchFields.some((field) => changedFields.includes(field));
  }

  /**
   * Gets embedded data from the source model.
   *
   * @param data - Source model data or Model instance
   * @param config - Sync configuration
   * @returns Embedded data
   */
  private async getEmbedData(
    data: Record<string, unknown> | Model,
    config: SyncConfig,
  ): Promise<Record<string, unknown>> {
    // If data is a Model instance, call the embed method on it
    if (data instanceof Model) {
      const hidden = data.self().hidden ?? [];
      const withoutHidden = (embedded: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(embedded).filter(([key]) => !hidden.includes(key)));

      if (Array.isArray(config.embedKey)) {
        return withoutHidden(data.only(config.embedKey));
      }

      if (typeof data[config.embedKey as keyof Model] !== "function") {
        return withoutHidden(data[config.embedKey as keyof Model] as Record<string, unknown>);
      }

      // The model declares an explicit `embed` column list
      if (data.self().embed) {
        return withoutHidden(data.embedData);
      }

      // Default: the model's public (serialised) shape, which strips hidden fields
      return data.toJSON() as Record<string, unknown>;
    }

    // Otherwise, return the data as-is
    return data as Record<string, unknown>;
  }

  /**
   * Gets sync configurations from the source model.
   *
   * @returns Array of sync configurations
   */
  private getSyncConfigs(): SyncConfig[] {
    const syncWith = (this.sourceModel as any).syncWith;

    if (!syncWith || !Array.isArray(syncWith)) {
      return [];
    }

    return syncWith.map((builder: any) =>
      typeof builder.build === "function" ? builder.build() : builder,
    );
  }

  /**
   * Emits a syncing event.
   *
   * @param instruction - The sync instruction
   */
  private async emitSyncingEvent(instruction: SyncInstruction): Promise<void> {
    const payload: SyncEventPayload = {
      sourceModel: instruction.sourceModel,
      sourceId: instruction.sourceId,
      targetModel: instruction.targetModel,
      filter: instruction.filter,
      update: instruction.update,
      affectedCount: 0, // Not yet known
      depth: instruction.depth,
      chain: instruction.chain,
    };

    // Emit on source model
    if (typeof (this.sourceModel as any).emitSyncEvent === "function") {
      await (this.sourceModel as any).emitSyncEvent("syncing", payload);
    }
  }

  /**
   * Emits a synced event.
   *
   * @param context - The sync context
   */
  private async emitSyncedEvent(context: any): Promise<void> {
    const payload: SyncEventPayload = {
      sourceModel: context.sourceModel,
      sourceId: context.sourceId,
      targetModel: context.targetModel,
      filter: context.filter,
      update: context.update,
      affectedCount: context.affectedCount,
      depth: context.currentDepth,
      chain: context.syncChain,
    };

    // Emit on source model
    if (typeof (this.sourceModel as any).emitSyncEvent === "function") {
      await (this.sourceModel as any).emitSyncEvent("synced", payload);
    }
  }

  /**
   * Creates an empty sync result.
   *
   * @returns Empty sync result
   */
  private createEmptyResult(): SyncResult {
    return {
      success: true,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      depthReached: 0,
      contexts: [],
    };
  }
}
