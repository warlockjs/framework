import { addCommand } from "./commands/add.command";
import { buildCommand } from "./commands/build.command";
import { devServerCommand } from "./commands/dev-server.command";
import {
  generateCommand,
  generateControllerCommand,
  generateMigrationCommand,
  generateModelCommand,
  generateModuleCommand,
  generateRepositoryCommand,
  generateResourceCommand,
  generateServiceCommand,
  generateValidationCommand,
} from "./commands/generate/generate.command";
import { migrateCommand } from "./commands/migrate.command";
import { seedCommand } from "./commands/seed.command";

import { createDatabaseCommand } from "./commands/create-database.command";
import { startProductionCommand } from "./commands/start-production.command";
import { typingsGeneratorCommand } from "./commands/typings-generator.command";

export const frameworkCommands = [
  devServerCommand,
  buildCommand,
  startProductionCommand,
  typingsGeneratorCommand,

  // database commands
  migrateCommand,
  seedCommand,
  createDatabaseCommand,

  // generation/installation commands
  addCommand,

  // scaffolding commands
  generateCommand,
  generateModuleCommand,
  generateControllerCommand,
  generateServiceCommand,
  generateModelCommand,
  generateRepositoryCommand,
  generateResourceCommand,
  generateValidationCommand,
  generateMigrationCommand,
];
