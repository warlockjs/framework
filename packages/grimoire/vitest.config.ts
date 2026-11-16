import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "tests/**/*.spec.ts"],
    // Fixture projects hold their own test files (read for `@proves` lines), never run here.
    exclude: ["**/node_modules/**", "tests/fixtures/**"],
    testTimeout: process.platform === "win32" ? 60_000 : 10_000,
  },
});
