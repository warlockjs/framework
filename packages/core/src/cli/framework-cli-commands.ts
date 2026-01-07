import { addCommand } from "./commands/add.command";
import { buildCommand } from "./commands/build.command";
import { devServerCommand } from "./commands/dev-server.command";
import { migrateCommand } from "./commands/migrate.command";
import { seedCommand } from "./commands/seed.command";
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

  // generation/installation commands
  addCommand,
];
