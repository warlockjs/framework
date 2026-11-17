import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Specs that need a real database (the cascade store of the production
 * monitor). Not part of `pnpm test`; see the spec files for the connection
 * settings they read.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/**/*.integration.spec.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
    },
  }),
);
