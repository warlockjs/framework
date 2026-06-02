//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-sync-adapter.ts
/**
* MongoDB implementation of the sync adapter.
* Handles array updates using positional operators and arrayFilters.
* Automatically participates in active transactions via the driver's session context.
*/
var MongoSyncAdapter = class {
	driver;
	/**
	* Creates a new MongoDB sync adapter.
	*
	* @param driver - The MongoDB driver instance (provides session-aware operations)
	*/
	constructor(driver) {
		this.driver = driver;
	}
	/**
	* Executes a batch of sync instructions.
	*
	* @param instructions - Array of sync instructions
	* @returns Total number of documents affected
	*/
	async executeBatch(instructions) {
		let totalAffected = 0;
		for (const instruction of instructions) {
			const affected = instruction.isArrayUpdate ? await this.executeArrayUpdate(instruction) : await this.executeOne(instruction);
			totalAffected += affected;
		}
		return totalAffected;
	}
	/**
	* Executes a single sync instruction.
	* Uses the driver's updateMany to automatically participate in active transactions.
	*
	* @param instruction - The sync instruction
	* @returns Number of documents affected
	*/
	async executeOne(instruction) {
		return (await this.driver.updateMany(instruction.targetTable, instruction.filter, instruction.update)).modifiedCount;
	}
	/**
	* Executes an array update using MongoDB positional operators.
	* Uses the driver's updateMany to automatically participate in active transactions.
	*
	* @param instruction - The sync instruction with array info
	* @returns Number of documents affected
	*/
	async executeArrayUpdate(instruction) {
		if (!instruction.arrayField || !instruction.identifierField) throw new Error("Array update requires arrayField and identifierField to be specified");
		if (this.canUsePositionalOperator(instruction)) return (await this.driver.updateMany(instruction.targetTable, instruction.filter, instruction.update)).modifiedCount;
		return await this.executeWithArrayFilters(instruction);
	}
	/**
	* Checks if positional operator $ can be used.
	* Requires filter to already match the array element.
	*
	* @param instruction - The sync instruction
	* @returns True if positional operator can be used
	*/
	canUsePositionalOperator(instruction) {
		return `${instruction.arrayField}.${instruction.identifierField}` in instruction.filter;
	}
	/**
	* Executes array update using arrayFilters.
	* Uses the driver's updateMany with arrayFilters option to participate in transactions.
	*
	* @param instruction - The sync instruction
	* @returns Number of documents affected
	*/
	async executeWithArrayFilters(instruction) {
		const arrayFilters = [{ [`elem.${instruction.identifierField}`]: instruction.identifierValue }];
		const transformedUpdate = this.transformUpdateForArrayFilters(instruction.update, instruction.arrayField);
		const optimizedFilter = this.buildOptimizedFilter(instruction.filter, instruction.arrayField, instruction.identifierField);
		return (await this.driver.updateMany(instruction.targetTable, optimizedFilter, transformedUpdate, { arrayFilters })).modifiedCount;
	}
	/**
	* Builds an optimized filter to reduce the number of documents scanned.
	* Adds array existence check when filter doesn't already match array elements.
	*
	* @param originalFilter - The original filter from the instruction
	* @param arrayField - The array field path
	* @param identifierField - The identifier field within array elements
	* @returns Optimized filter
	*/
	buildOptimizedFilter(originalFilter, arrayField, identifierField) {
		if (`${arrayField}.${identifierField}` in originalFilter) return originalFilter;
		return {
			...originalFilter,
			[arrayField]: {
				$exists: true,
				$ne: []
			}
		};
	}
	/**
	* Transforms update operation to use arrayFilters placeholder.
	*
	* @param update - Original update operation
	* @param arrayField - Array field path
	* @returns Transformed update operation
	*/
	transformUpdateForArrayFilters(update, arrayField) {
		const transformed = {};
		for (const [operator, fields] of Object.entries(update)) if (typeof fields === "object" && fields !== null) {
			const transformedFields = {};
			for (const [field, value] of Object.entries(fields)) {
				const transformedField = field.replace(`${arrayField}.$`, `${arrayField}.$[elem]`);
				transformedFields[transformedField] = value;
			}
			transformed[operator] = transformedFields;
		}
		return transformed;
	}
};
//#endregion
export { MongoSyncAdapter };

//# sourceMappingURL=mongodb-sync-adapter.mjs.map