import { addCommand } from "./commands/add.command.mjs";
import { buildCommand } from "./commands/build.command.mjs";
import { createDatabaseCommand } from "./commands/create-database.command.mjs";
import { devServerCommand } from "./commands/dev-server.command.mjs";
import { dropTablesCommand } from "./commands/drop-tables.command.mjs";
import { generateCommand, generateControllerCommand, generateMigrationCommand, generateModelCommand, generateModuleCommand, generateRepositoryCommand, generateResourceCommand, generateServiceCommand } from "./commands/generate/generate.command.mjs";
import { migrateCommand } from "./commands/migrate.command.mjs";
import { seedCommand } from "./commands/seed.command.mjs";
import { startProductionCommand } from "./commands/start-production.command.mjs";
import { storagePutCommand } from "./commands/storage-put.command.mjs";
import { typingsGeneratorCommand } from "./commands/typings-generator.command.mjs";
//#region ../../@warlock.js/core/src/cli/framework-cli-commands.ts
const frameworkCommands = [
	devServerCommand,
	typingsGeneratorCommand,
	buildCommand,
	startProductionCommand,
	migrateCommand,
	seedCommand,
	createDatabaseCommand,
	dropTablesCommand,
	addCommand,
	generateCommand,
	generateModuleCommand,
	generateControllerCommand,
	generateServiceCommand,
	generateModelCommand,
	generateRepositoryCommand,
	generateResourceCommand,
	generateMigrationCommand,
	storagePutCommand
];
//#endregion
export { frameworkCommands };

//# sourceMappingURL=framework-cli-commands.mjs.map