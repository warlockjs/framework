/*
  A fixture standing in for a real app config. It imports from @warlock.js/core
  ON PURPOSE: that import is what made `ts.createProgram` pull the whole
  monorepo into a 2,908-file program to read four statements.

  Nothing here is ever executed — only parsed.
*/
import type { HttpConfigurations } from "@warlock.js/core";
import { env } from "@warlock.js/core";

export const httpConfig: HttpConfigurations = {
  port: env("PORT", 3000),
  host: env("HOST", "localhost"),
  timeout: 30000,
};
