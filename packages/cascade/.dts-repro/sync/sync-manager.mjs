import { SyncContextManager } from "./sync-context.mjs";
import { Model } from "../model/model.mjs";
//#region ../../@warlock.js/cascade/src/sync/sync-manager.ts
/**
* Manages sync operations across models with multi-level support.
*/
var SyncManager = class {
	sourceModel;
	driver;
	/**
	* Creates a new sync manager.
	*
	* @param sourceModel - The source model class
	* @param driver - The database driver
	*/
	constructor(sourceModel, driver) {
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
	async syncUpdate(sourceId, updatedData, changedFields) {
		try {
			const syncConfigs = this.getSyncConfigs();
			if (syncConfigs.length === 0) return this.createEmptyResult();
			const options = {
				currentDepth: 1,
				syncChain: [this.sourceModel.name],
				maxDepth: 3,
				preventCircular: true
			};
			const instructions = await this.collectInstructions({
				sourceId,
				updatedData,
				changedFields,
				syncConfigs,
				options
			});
			return await this.executeInstructions(instructions);
		} catch (error) {
			console.error(`Sync update failed for ${this.sourceModel.name}#${sourceId}:`, error);
			return {
				success: false,
				attempted: 0,
				succeeded: 0,
				failed: 1,
				errors: [{
					instruction: {
						targetTable: "",
						targetModel: "",
						filter: {},
						update: {},
						depth: 0,
						chain: [this.sourceModel.name],
						sourceModel: this.sourceModel.name,
						sourceId
					},
					error: error instanceof Error ? error : new Error(String(error))
				}],
				depthReached: 0,
				contexts: []
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
	async syncUpdateWithConfig(sourceId, updatedData, changedFields, config) {
		try {
			const options = {
				currentDepth: 1,
				syncChain: [this.sourceModel.name],
				maxDepth: config.maxSyncDepth,
				preventCircular: config.preventCircularSync
			};
			const instructions = await this.collectInstructions({
				sourceId,
				updatedData,
				changedFields,
				syncConfigs: [config],
				options
			});
			return await this.executeInstructions(instructions);
		} catch (error) {
			console.error(`Sync update with config failed for ${this.sourceModel.name}#${sourceId}:`, error);
			return {
				success: false,
				attempted: 0,
				succeeded: 0,
				failed: 1,
				errors: [{
					instruction: {
						targetTable: "",
						targetModel: "",
						filter: {},
						update: {},
						depth: 0,
						chain: [this.sourceModel.name],
						sourceModel: this.sourceModel.name,
						sourceId
					},
					error: error instanceof Error ? error : new Error(String(error))
				}],
				depthReached: 0,
				contexts: []
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
	async syncDeleteWithConfig(sourceId, config) {
		try {
			if (!config.unsetOnDelete) return this.createEmptyResult();
			const options = {
				currentDepth: 1,
				syncChain: [this.sourceModel.name],
				maxDepth: config.maxSyncDepth,
				preventCircular: config.preventCircularSync
			};
			const instructions = await this.collectDeleteInstructions(sourceId, [config], options);
			return await this.executeInstructions(instructions);
		} catch (error) {
			console.error(`Sync delete with config failed for ${this.sourceModel.name}#${sourceId}:`, error);
			return {
				success: false,
				attempted: 0,
				succeeded: 0,
				failed: 1,
				errors: [{
					instruction: {
						targetTable: "",
						targetModel: "",
						filter: {},
						update: {},
						depth: 0,
						chain: [this.sourceModel.name],
						sourceModel: this.sourceModel.name,
						sourceId
					},
					error: error instanceof Error ? error : new Error(String(error))
				}],
				depthReached: 0,
				contexts: []
			};
		}
	}
	/**
	* Executes sync operations for a model deletion.
	*
	* @param sourceId - The source model ID
	* @returns Sync result with success status and details
	*/
	async syncDelete(sourceId) {
		try {
			const syncConfigs = this.getSyncConfigs();
			if (syncConfigs.length === 0) return this.createEmptyResult();
			const options = {
				currentDepth: 1,
				syncChain: [this.sourceModel.name],
				maxDepth: 3,
				preventCircular: true
			};
			const instructions = await this.collectDeleteInstructions(sourceId, syncConfigs, options);
			return await this.executeInstructions(instructions);
		} catch (error) {
			console.error(`Sync delete failed for ${this.sourceModel.name}#${sourceId}:`, error);
			return {
				success: false,
				attempted: 0,
				succeeded: 0,
				failed: 1,
				errors: [{
					instruction: {
						targetTable: "",
						targetModel: "",
						filter: {},
						update: {},
						depth: 0,
						chain: [this.sourceModel.name],
						sourceModel: this.sourceModel.name,
						sourceId
					},
					error: error instanceof Error ? error : new Error(String(error))
				}],
				depthReached: 0,
				contexts: []
			};
		}
	}
	/**
	* Collects sync instructions recursively with depth limiting.
	*
	* @param payload - Data payload
	* @returns Array of sync instructions
	*/
	async collectInstructions(payload) {
		const { sourceId, updatedData, changedFields, syncConfigs, options } = payload;
		const instructions = [];
		for (const config of syncConfigs) {
			if (!this.shouldSync(config, changedFields)) continue;
			const validation = SyncContextManager.validate(options.currentDepth, options.syncChain, config.targetModelClass.name, config.maxSyncDepth, config.preventCircularSync);
			if (!validation.valid) {
				console.warn(`Sync validation failed: ${validation.error}`);
				continue;
			}
			const embedData = await this.getEmbedData(updatedData, config);
			const instruction = this.buildUpdateInstruction(sourceId, config, embedData, options);
			instructions.push(instruction);
			await this.emitSyncingEvent(instruction);
			if (SyncContextManager.canSyncDeeper(options.currentDepth, config.maxSyncDepth)) {
				const nextLevelInstructions = await this.collectNextLevelInstructions(instruction, embedData, changedFields, config, options);
				instructions.push(...nextLevelInstructions);
			}
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
	async collectDeleteInstructions(sourceId, syncConfigs, options) {
		const instructions = [];
		for (const config of syncConfigs) {
			if (!config.unsetOnDelete) continue;
			if (!SyncContextManager.validate(options.currentDepth, options.syncChain, config.targetModelClass.name, config.maxSyncDepth, config.preventCircularSync).valid) continue;
			const instruction = this.buildDeleteInstruction(sourceId, config, options);
			instructions.push(instruction);
			await this.emitSyncingEvent(instruction);
		}
		return instructions;
	}
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
	async collectNextLevelInstructions(parentInstruction, embedData, changedFields, parentConfig, parentOptions) {
		const targetModelClass = parentConfig.targetModelClass;
		const targetSyncConfigs = this.getSyncConfigsForModel(targetModelClass);
		if (targetSyncConfigs.length === 0) return [];
		const nextOptions = {
			currentDepth: parentOptions.currentDepth + 1,
			syncChain: SyncContextManager.extendChain(parentOptions.syncChain, targetModelClass.name),
			maxDepth: Math.min(parentConfig.maxSyncDepth, parentOptions.maxDepth),
			preventCircular: parentOptions.preventCircular && parentConfig.preventCircularSync
		};
		const sourceId = embedData[parentConfig.identifierField];
		return await this.collectInstructions({
			sourceId,
			updatedData: embedData,
			changedFields,
			syncConfigs: targetSyncConfigs,
			options: nextOptions
		});
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
	buildUpdateInstruction(sourceId, config, embedData, options) {
		const targetModelClass = config.targetModelClass;
		const filter = this.buildFilter(sourceId, config);
		const update = this.buildUpdate(embedData, config);
		const instruction = {
			targetTable: targetModelClass.table,
			targetModel: targetModelClass.name,
			filter,
			update,
			depth: options.currentDepth,
			chain: [...options.syncChain],
			sourceModel: this.sourceModel.name,
			sourceId
		};
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
	buildDeleteInstruction(sourceId, config, options) {
		const targetModelClass = config.targetModelClass;
		const filter = this.buildFilter(sourceId, config);
		const update = { $unset: { [config.targetField]: 1 } };
		return {
			targetTable: targetModelClass.table,
			targetModel: targetModelClass.name,
			filter,
			update,
			depth: options.currentDepth,
			chain: [...options.syncChain],
			sourceModel: this.sourceModel.name,
			sourceId
		};
	}
	/**
	* Builds a filter for identifying target documents.
	*
	* @param sourceId - Source model ID
	* @param config - Sync configuration
	* @returns Filter object
	*/
	buildFilter(sourceId, config) {
		if (config.isMany) return { [`${config.targetField}.${config.identifierField}`]: sourceId };
		else return { [`${config.targetField}.${config.identifierField}`]: sourceId };
	}
	/**
	* Builds an update operation for syncing data.
	*
	* @param embedData - Embedded data to sync
	* @param config - Sync configuration
	* @returns Update operation object
	*/
	buildUpdate(embedData, config) {
		if (config.isMany) return { $set: { [`${config.targetField}.$`]: embedData } };
		else return { $set: { [config.targetField]: embedData } };
	}
	/**
	* Executes sync instructions with batch optimization.
	* Groups by depth and target table for optimal batching.
	*
	* @param instructions - Array of sync instructions
	* @returns Sync result
	*/
	async executeInstructions(instructions) {
		const result = {
			success: true,
			attempted: instructions.length,
			succeeded: 0,
			failed: 0,
			errors: [],
			depthReached: 0,
			contexts: []
		};
		if (instructions.length === 0) return result;
		const instructionsByDepth = this.groupByDepth(instructions);
		for (const [depth, depthInstructions] of instructionsByDepth) {
			result.depthReached = Math.max(result.depthReached, depth);
			const instructionsByTable = this.groupByTable(depthInstructions);
			for (const [table, tableInstructions] of instructionsByTable) try {
				await this.executeBatch(tableInstructions, result);
			} catch (batchError) {
				console.warn(`Batch execution failed for table ${table} at depth ${depth}, falling back to individual execution`);
				await this.executeIndividual(tableInstructions, result);
			}
		}
		result.success = result.failed === 0;
		return result;
	}
	/**
	* Executes instructions in batch.
	*
	* @param instructions - Instructions to execute
	* @param result - Result object to update
	*/
	async executeBatch(instructions, result) {
		for (const instruction of instructions) try {
			const updateResult = await this.driver.updateMany(instruction.targetTable, instruction.filter, instruction.update);
			const context = SyncContextManager.createContext(instruction, updateResult.modifiedCount);
			result.contexts.push(context);
			result.succeeded++;
			await this.emitSyncedEvent(context);
		} catch (error) {
			throw error;
		}
	}
	/**
	* Executes instructions individually (fallback).
	* Provides detailed error reporting for each failed instruction.
	*
	* @param instructions - Instructions to execute
	* @param result - Result object to update
	*/
	async executeIndividual(instructions, result) {
		for (const instruction of instructions) try {
			const updateResult = await this.driver.updateMany(instruction.targetTable, instruction.filter, instruction.update);
			const context = SyncContextManager.createContext(instruction, updateResult.modifiedCount);
			result.contexts.push(context);
			result.succeeded++;
			await this.emitSyncedEvent(context);
		} catch (error) {
			result.failed++;
			const errorMessage = this.formatSyncError(instruction, error);
			const syncError = new Error(errorMessage);
			if (error instanceof Error && error.stack) syncError.stack = error.stack;
			result.errors.push({
				instruction,
				error: syncError
			});
			console.error(`Sync operation failed:`, {
				sourceModel: instruction.sourceModel,
				sourceId: instruction.sourceId,
				targetModel: instruction.targetModel,
				targetTable: instruction.targetTable,
				depth: instruction.depth,
				chain: SyncContextManager.formatChain(instruction.chain),
				filter: instruction.filter,
				error: errorMessage
			});
		}
	}
	/**
	* Formats a sync error with detailed context.
	*
	* @param instruction - The failed instruction
	* @param error - The error that occurred
	* @returns Formatted error message
	*/
	formatSyncError(instruction, error) {
		const baseMessage = error instanceof Error ? error.message : String(error);
		const chain = SyncContextManager.formatChain(instruction.chain);
		return [
			`Sync failed at depth ${instruction.depth}:`,
			`Chain: ${chain} → ${instruction.targetModel}`,
			`Source: ${instruction.sourceModel}#${instruction.sourceId}`,
			`Target: ${instruction.targetTable}`,
			`Error: ${baseMessage}`
		].join(" | ");
	}
	/**
	* Groups instructions by depth for batch processing.
	*
	* @param instructions - Instructions to group
	* @returns Map of depth to instructions (sorted ascending)
	*/
	groupByDepth(instructions) {
		const grouped = /* @__PURE__ */ new Map();
		for (const instruction of instructions) {
			const depth = instruction.depth;
			if (!grouped.has(depth)) grouped.set(depth, []);
			grouped.get(depth).push(instruction);
		}
		return new Map([...grouped.entries()].sort((a, b) => a[0] - b[0]));
	}
	/**
	* Groups instructions by target table for batch optimization.
	*
	* @param instructions - Instructions to group
	* @returns Map of table name to instructions
	*/
	groupByTable(instructions) {
		const grouped = /* @__PURE__ */ new Map();
		for (const instruction of instructions) {
			const table = instruction.targetTable;
			if (!grouped.has(table)) grouped.set(table, []);
			grouped.get(table).push(instruction);
		}
		return grouped;
	}
	/**
	* Checks if sync should proceed based on watched fields.
	*
	* @param config - Sync configuration
	* @param changedFields - Fields that changed
	* @returns True if sync should proceed
	*/
	shouldSync(config, changedFields) {
		if (config.watchFields.length === 0) return true;
		return config.watchFields.some((field) => changedFields.includes(field));
	}
	/**
	* Gets embedded data from the source model.
	*
	* @param data - Source model data or Model instance
	* @param config - Sync configuration
	* @returns Embedded data
	*/
	async getEmbedData(data, config) {
		if (data instanceof Model) {
			if (Array.isArray(config.embedKey)) return data.only(config.embedKey);
			if (typeof data[config.embedKey] !== "function") return data[config.embedKey];
			if (typeof data.embedData === "function") return data.embedData;
			return data.data;
		}
		return data;
	}
	/**
	* Gets sync configurations from the source model.
	*
	* @returns Array of sync configurations
	*/
	getSyncConfigs() {
		const syncWith = this.sourceModel.syncWith;
		if (!syncWith || !Array.isArray(syncWith)) return [];
		return syncWith.map((builder) => typeof builder.build === "function" ? builder.build() : builder);
	}
	/**
	* Gets sync configurations for a specific model.
	*
	* @param modelClass - The model class
	* @returns Array of sync configurations
	*/
	getSyncConfigsForModel(modelClass) {
		const syncWith = modelClass.syncWith;
		if (!syncWith || !Array.isArray(syncWith)) return [];
		return syncWith.map((builder) => typeof builder.build === "function" ? builder.build() : builder);
	}
	/**
	* Emits a syncing event.
	*
	* @param instruction - The sync instruction
	*/
	async emitSyncingEvent(instruction) {
		const payload = {
			sourceModel: instruction.sourceModel,
			sourceId: instruction.sourceId,
			targetModel: instruction.targetModel,
			filter: instruction.filter,
			update: instruction.update,
			affectedCount: 0,
			depth: instruction.depth,
			chain: instruction.chain
		};
		if (typeof this.sourceModel.emitSyncEvent === "function") await this.sourceModel.emitSyncEvent("syncing", payload);
	}
	/**
	* Emits a synced event.
	*
	* @param context - The sync context
	*/
	async emitSyncedEvent(context) {
		const payload = {
			sourceModel: context.sourceModel,
			sourceId: context.sourceId,
			targetModel: context.targetModel,
			filter: context.filter,
			update: context.update,
			affectedCount: context.affectedCount,
			depth: context.currentDepth,
			chain: context.syncChain
		};
		if (typeof this.sourceModel.emitSyncEvent === "function") await this.sourceModel.emitSyncEvent("synced", payload);
	}
	/**
	* Creates an empty sync result.
	*
	* @returns Empty sync result
	*/
	createEmptyResult() {
		return {
			success: true,
			attempted: 0,
			succeeded: 0,
			failed: 0,
			errors: [],
			depthReached: 0,
			contexts: []
		};
	}
};
//#endregion
export { SyncManager };

//# sourceMappingURL=sync-manager.mjs.map