import {
  authMigrations,
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";
import { registerGrimoireCommands } from "@warlock.js/grimoire/warlock";

export default defineConfig({
  build: { budgets: { page: { js: "150kb", css: "50kb" }, mode: "error" } },
  cli: {
    commands: [
      registerJWTSecretGeneratorCommand(),
      registerAuthCleanupCommand(),
      registerGrimoireCommands(),
    ],
  },
  database: {
    migrations: authMigrations,
  },
});
