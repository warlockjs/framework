import { seedsTableName } from "./utils.mjs";
import { SeedsTableMigration } from "./seeds-table-migration.mjs";
import { DatabaseWriterValidationError, dataSourceRegistry, migrationRunner, transaction } from "@warlock.js/cascade";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/database/seeds/seeders.manager.ts
var SeedersManager = class {
	constructor(options) {
		this.options = options;
		this.seeders = [];
		this.datasource = options?.datasource ?? dataSourceRegistry.get();
	}
	/**
	* Register new seeder
	*/
	register(...seeders) {
		this.seeders.push(...seeders);
		return this;
	}
	/**
	* Initialize before running
	*/
	async init() {
		if (!await this.driver.blueprint.tableExists("_seeds")) await migrationRunner.run(SeedsTableMigration);
	}
	/**
	* Run seeders
	*/
	async run(withTransaction = true) {
		await this.init();
		this.prepareSeeders();
		console.log(`🌱 Running ${this.seeders.length} seeder(s)...\n`);
		let successCount = 0;
		let skippedCount = 0;
		let failedCount = 0;
		for (const seeder of this.seeders) {
			if (seeder.once && await this.seederIsExecutedBefore(seeder)) {
				console.log(`⏭️  Skipping ${colors.yellow(seeder.name)} (already executed)`);
				skippedCount++;
				continue;
			}
			try {
				console.log(`🔄 Running ${colors.green(seeder.name)}...`);
				const startTime = Date.now();
				const result = withTransaction ? await transaction(async () => seeder.run()) : await seeder.run();
				const duration = Date.now() - startTime;
				if (result) await this.storeSeedsResults(seeder, result);
				console.log(`✅ ${colors.green(seeder.name)} completed (${duration}ms, ${result?.recordsCreated ?? 0} records)\n`);
				successCount++;
			} catch (error) {
				const err = error;
				console.error(`❌ ${colors.red(seeder.name)} failed:`, err.message);
				console.log(err);
				failedCount++;
				if (error instanceof DatabaseWriterValidationError) console.log(error.errors);
				throw error;
			}
		}
		console.log("\n" + "=".repeat(50));
		console.log(`✅ Success: ${successCount}`);
		if (skippedCount > 0) console.log(`⏭️  Skipped: ${skippedCount}`);
		if (failedCount > 0) console.log(`❌ Failed: ${failedCount}`);
		console.log("=".repeat(50));
	}
	/**
	* Sort seeds
	*/
	sort() {
		this.seeders = this.seeders.sort((a, b) => {
			return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
		});
		return this;
	}
	/**
	* Prepare seeders to order by the seeder order
	* Also keep an eye on the dependsOn for each seeder to make sure
	* they are ordered correctly
	*/
	prepareSeeders() {
		this.seeders = this.seeders.filter((seeder) => seeder.enabled !== false);
		this.sort();
	}
	/**
	* Store seed results in db
	*/
	async storeSeedsResults(seeder, result) {
		const oldResult = await this.getMetadata(seeder);
		console.log(`📊 Total records created: ${result.recordsCreated}`);
		if (oldResult) {
			await this.driver.queryBuilder(seedsTableName).where("name", seeder.name).update({
				runCount: oldResult.runCount + 1,
				lastRunAt: /* @__PURE__ */ new Date(),
				totalRecordsCreated: oldResult.totalRecordsCreated + result.recordsCreated,
				lastRunRecordsCreated: result.recordsCreated
			});
			console.log(`📊 Total records created so far: ${oldResult.totalRecordsCreated + result.recordsCreated}`);
		} else await this.driver.insert(seedsTableName, {
			name: seeder.name,
			createdAt: /* @__PURE__ */ new Date(),
			firstRunAt: /* @__PURE__ */ new Date(),
			lastRunAt: /* @__PURE__ */ new Date(),
			runCount: 1,
			totalRecordsCreated: result.recordsCreated,
			lastRunRecordsCreated: result.recordsCreated
		});
	}
	/**
	* Get seed info from database
	*/
	getMetadata(seeder) {
		return this.datasource.driver.queryBuilder(seedsTableName).where("name", seeder.name).first();
	}
	/**
	* Get driver instance
	*/
	get driver() {
		return this.datasource.driver;
	}
	/**
	* Check if seeder has been executed before
	*/
	async seederIsExecutedBefore(seeder) {
		return !!await this.getMetadata(seeder);
	}
};
//#endregion
export { SeedersManager };

//# sourceMappingURL=seeders.manager.mjs.map