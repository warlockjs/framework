import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Specs that need a real database (the cascade store of the production
 * monitor). Not part of `pnpm test`; see the spec files for the connection
 * settings they read. Built from the base config without `mergeConfig`, which
 * would concatenate `include`/`exclude` and keep the integration specs out.
 */
export default defineConfig({
  resolve: base.resolve,
  test: {
    ...base.test,
    include: ["tests/**/*.integration.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
