import { aiCommand } from "./commands/ai.command";
import { addCommand } from "./commands/add.command";
import { agentsMdCommand } from "./commands/agents-md.command";
import { boardCommand } from "./commands/board.command";
import { buildCommand } from "./commands/build.command";
import { checkCommand } from "./commands/check.command";
import { createDatabaseCommand } from "./commands/create-database.command";
import { devServerCommand } from "./commands/dev-server.command";
import { e2eCommand } from "./commands/e2e.command";
import { doctorCommand } from "./commands/doctor.command";
import { dropTablesCommand } from "./commands/drop-tables.command";
import { explainCommand } from "./commands/explain.command";
import {
  generateCommand,
  generateControllerCommand,
  generateEndpointCommand,
  generateMigrationCommand,
  generateModelCommand,
  generateModuleCommand,
  generateRepositoryCommand,
  generateResourceCommand,
  generateServiceCommand,
  generateUseCaseCommand,
  makeCommand,
} from "./commands/generate/generate.command";
import { inspectCommand } from "./commands/inspect.command";
import { issueCommand } from "./commands/issue.command";
import { mcpCommand } from "./commands/mcp.command";
import { migrateCommand } from "./commands/migrate.command";
import { openApiGeneratorCommand } from "./commands/openapi-generator.command";
import { postmanGeneratorCommand } from "./commands/postman-generator.command";
import { pm2Command } from "./commands/pm2.command";
import { releaseCommand } from "./commands/release.command";
import { routesCommand, routesDiffCommand } from "./commands/routes.command";
import { seedCommand } from "./commands/seed.command";
import { startProductionCommand } from "./commands/start-production.command";
import { traceCommand } from "./commands/trace.command";
import { storagePutCommand } from "./commands/storage-put.command";
import { typecheckCommand } from "./commands/typecheck.command";
import { testCommand } from "./commands/test.command";
import { typingsGeneratorCommand } from "./commands/typings-generator.command";
import { updateCommand } from "./commands/update.command";
import { upgradeCommand } from "./commands/upgrade.command";

export const frameworkCommands = [
  // development commands
  devServerCommand,
  typingsGeneratorCommand,
  openApiGeneratorCommand,
  postmanGeneratorCommand,

  // testing commands
  testCommand,
  e2eCommand,

  // diagnostics commands
  aiCommand,
  doctorCommand,
  routesCommand,
  routesDiffCommand,
  inspectCommand,
  explainCommand,
  issueCommand,
  checkCommand,
  typecheckCommand,

  // agent tooling commands
  mcpCommand,
  traceCommand,
  agentsMdCommand,
  boardCommand,

  // production commands
  buildCommand,
  startProductionCommand,
  pm2Command,
  releaseCommand,

  // database commands
  migrateCommand,
  seedCommand,
  createDatabaseCommand,
  dropTablesCommand,

  // generation/installation commands
  addCommand,
  updateCommand,
  upgradeCommand,

  // scaffolding commands
  generateCommand,
  makeCommand,
  generateEndpointCommand,
  generateModuleCommand,
  generateControllerCommand,
  generateServiceCommand,
  generateUseCaseCommand,
  generateModelCommand,
  generateRepositoryCommand,
  generateResourceCommand,
  generateMigrationCommand,

  // storage commands
  storagePutCommand,
];
