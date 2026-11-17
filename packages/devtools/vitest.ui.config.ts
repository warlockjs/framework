import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The dashboard's specs (React + Testing Library on jsdom). Kept apart from
 * `vitest.config.ts`, which runs the server specs in Node.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contracts": path.resolve(import.meta.dirname, "src/production/contracts.ts"),
      "@": path.resolve(import.meta.dirname, "ui-src/src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["ui-src/tests/**/*.spec.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["ui-src/tests/setup.ts"],
    testTimeout: 30_000,
  },
});
