//#region ../../@warlock.js/cascade/src/sync/sync-context.ts
/**
* Default maximum sync depth.
* Prevents infinite sync chains.
*/
const DEFAULT_MAX_SYNC_DEPTH = 3;
/**
* Manages sync context and provides validation utilities.
*/
var SyncContextManager = class {
	/**
	* Creates a new sync context from a sync instruction.
	*
	* @param instruction - The sync instruction to create context from
	* @param affectedCount - Number of documents affected
	* @returns A new sync context
	*/
	static createContext(instruction, affectedCount) {
		return {
			sourceModel: instruction.sourceModel,
			sourceId: instruction.sourceId,
			currentDepth: instruction.depth,
			syncChain: [...instruction.chain],
			targetModel: instruction.targetModel,
			filter: { ...instruction.filter },
			update: { ...instruction.update },
			affectedCount,
			timestamp: /* @__PURE__ */ new Date()
		};
	}
	/**
	* Validates if a sync operation can proceed based on depth and cycle detection.
	*
	* @param depth - Current sync depth
	* @param chain - Current sync chain
	* @param targetModel - Target model name
	* @param maxDepth - Maximum allowed depth
	* @param preventCircular - Whether to prevent circular references
	* @returns Validation result with success flag and optional error message
	*/
	static validate(depth, chain, targetModel, maxDepth, preventCircular) {
		if (depth > maxDepth) return {
			valid: false,
			error: `Sync depth limit exceeded: ${depth} > ${maxDepth}. Chain: ${chain.join(" → ")}`
		};
		if (preventCircular && this.hasCycle(chain, targetModel)) return {
			valid: false,
			error: `Circular sync detected: ${targetModel} already exists in chain [${chain.join(" → ")}]`
		};
		return { valid: true };
	}
	/**
	* Checks if adding a target model would create a cycle in the sync chain.
	*
	* @param chain - Current sync chain
	* @param targetModel - Model to be added to the chain
	* @returns True if adding the model would create a cycle
	*/
	static hasCycle(chain, targetModel) {
		return chain.includes(targetModel);
	}
	/**
	* Creates a new sync chain by appending a model name.
	*
	* @param chain - Current sync chain
	* @param modelName - Model name to append
	* @returns New sync chain array
	*/
	static extendChain(chain, modelName) {
		return [...chain, modelName];
	}
	/**
	* Formats a sync chain for display.
	*
	* @param chain - Sync chain to format
	* @returns Formatted string (e.g., "Category → Product → Module")
	*/
	static formatChain(chain) {
		return chain.join(" → ");
	}
	/**
	* Checks if the current depth allows for further syncing.
	*
	* @param currentDepth - Current depth in the chain
	* @param maxDepth - Maximum allowed depth
	* @returns True if more syncing is allowed
	*/
	static canSyncDeeper(currentDepth, maxDepth) {
		return currentDepth < maxDepth;
	}
};
//#endregion
export { DEFAULT_MAX_SYNC_DEPTH, SyncContextManager };

//# sourceMappingURL=sync-context.mjs.map