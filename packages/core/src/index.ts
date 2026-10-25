// Initialize Seal with Warlock configuration (localization, etc.)
import { env } from "@mongez/dotenv";
import "./validation/init";

import { colors } from "@mongez/copper";
export * from "@mongez/localization";
export * from "./application";
export * from "./benchmark";
export * from "./bootstrap";
export * from "./bootstrap/setup";
export * from "./cache";
export * from "./capabilities";
export * from "./config";
// The command-authoring API only — NOT `./cli`. Applications declare custom
// commands in `warlock.config.ts`, so `command` and `CLICommand` must stay on
// the package root. The full `./cli` barrel drags development tooling
// into every consumer's production graph; `cli-command.ts` imports
// nothing but types.
export * from "./commands";
export * from "./connectors";
export * from "./container";
export * from "./database";
export * from "./encryption";
export * from "./secrets";
// The stable error-code registry and `WarlockError`. Not `./errors`: its HTTP
// classes are already exported through `./http`.
export * from "./errors/error-codes";
export * from "./errors/warlock-error";
export * from "./http";
export * from "./image";
export * from "./logger";
export * from "./localization";
export * from "./mail";
export * from "./openapi";
export * from "./react";
export * from "./repositories";
export * from "./resource";
export * from "./restful";
export * from "./router";
export * from "./socket";
export * from "./storage";
export * from "./use-cases";
export * from "./utils";
export * from "./validation";
export * from "./warlock-config";

export { colors, env };
