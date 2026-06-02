import { seedsTableName } from "./utils.mjs";
import { Migration } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/database/seeds/seeds-table-migration.ts
var SeedsTableMigration = class extends Migration {
	constructor(..._args) {
		super(..._args);
		this.table = seedsTableName;
	}
	static {
		this.migrationName = "seeds-table-migration";
	}
	up() {
		this.createTableIfNotExists();
		this.id();
		this.text("name").unique();
		this.int("runCount").default(0);
		this.dateTime("createdAt").useCurrent();
		this.dateTime("firstRunAt").useCurrent();
		this.dateTime("lastRunAt").useCurrent();
		this.int("totalRecordsCreated").default(0);
		this.int("lastRunRecordsCreated").default(0);
	}
	down() {
		this.dropTableIfExists(seedsTableName);
	}
};
//#endregion
export { SeedsTableMigration };

//# sourceMappingURL=seeds-table-migration.mjs.map