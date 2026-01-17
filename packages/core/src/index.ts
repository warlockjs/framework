// Initialize Seal with Warlock configuration (localization, etc.)
import { env } from "@mongez/dotenv";
import "./validation/init";

import { colors } from "@mongez/copper";
export * from "./application";
export * from "./bootstrap";
export * from "./bootstrap/setup";
export * from "./cache";
export * from "./cli";
export * from "./config";
export * from "./database";
export * from "./dev2-server/connectors";
export * from "./dev2-server/health-checker";
export * from "./http";
export * from "./image";
export * from "./logger";
export * from "./mail";
export * from "./react";
export * from "./repositories";
export * from "./resource";
export * from "./restful";
export * from "./router";
export * from "./storage";
export * from "./store";
export * from "./utils";
export * from "./validation";
export * from "./warlock-config";

export { colors, env };
