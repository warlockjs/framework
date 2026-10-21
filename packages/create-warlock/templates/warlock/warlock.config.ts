import {
  authMigrations,
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  build: { budgets: { page: { js: "150kb", css: "50kb" }, mode: "error" } },
  cli: {
    commands: [registerJWTSecretGeneratorCommand(), registerAuthCleanupCommand()],
  },
  database: {
    migrations: authMigrations,
  },
});
