import { buildCommand } from "./commands/build.command";
import { devServerCommand } from "./commands/dev-server.command";
import { startProductionCommand } from "./commands/start-production.command";
import { typingsGeneratorCommand } from "./commands/typings-generator.command";

export const frameworkCommands = [
  devServerCommand,
  buildCommand,
  startProductionCommand,
  typingsGeneratorCommand,
];
