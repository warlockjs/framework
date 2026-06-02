import { colors } from "@mongez/copper";
//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-blueprint.ts
var MongoDBBlueprint = class {
	database;
	/**
	* Constructor
	*/
	constructor(database) {
		this.database = database;
	}
	/**
	* List all tables in the database
	*/
	async listTables() {
		return (await this.database.listCollections().toArray()).map((collection) => collection.name);
	}
	/**
	* List all indexes for a specific table
	*/
	async listIndexes(table) {
		return (await this.database.collection(table).indexes()).map(this.buildIndexInformation);
	}
	/**
	* Build index information
	*/
	buildIndexInformation(index) {
		return {
			name: index.name,
			type: index.type,
			columns: Object.keys(index.key),
			unique: !!index.unique,
			partial: !!index.partialFilterExpression,
			options: index
		};
	}
	/**
	* List all columns for a specific table
	*/
	async listColumns(table) {
		console.log(colors.yellowBright(`MongoDBBlueprint: listColumns(${table}) MongoDB does not have static columns`));
		return [];
	}
	/**
	* Check if the given table exists
	*/
	async tableExists(table) {
		return (await this.database.listCollections().toArray()).some((collection) => collection.name === table);
	}
};
//#endregion
export { MongoDBBlueprint };

//# sourceMappingURL=mongodb-blueprint.mjs.map