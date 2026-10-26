import path from "node:path";
import { defineConfig } from "vitest/config";

const core = path.resolve(import.meta.dirname, "../../../src");
const packages = path.resolve(core, "../..");
const source = (name: string) => path.join(packages, name, "src/index.ts");
const worker = process.env.EXIT_APP_LIFETIME === "worker";

// Mirrors the layout `warlock add test` generates: a plain unit project and an
// integration project with a global-setup HTTP server and the Warlock runner.
const shared = {
  resolve: {
    alias: [
      { find: /^@warlock\.js\/core\/tests$/, replacement: path.join(core, "tests/index.ts") },
      { find: /^@warlock\.js\/core$/, replacement: path.join(core, "index.ts") },
      ...["seal", "cascade", "context", "logger", "cache", "fs", "herald", "scheduler"].map(
        (name) => ({
          find: new RegExp(`^@warlock\\.js/${name}$`),
          replacement: source(name),
        }),
      ),
    ],
  },
  server: { fs: { allow: [packages] } },
};

// `EXIT_APP_EXTENDS=false` declares the inline projects with `extends: false`,
// so each carries its own copy of the shared options instead of inheriting the
// root config.
const inherit = process.env.EXIT_APP_EXTENDS !== "false";
const own = inherit ? {} : shared;

export default defineConfig({
  ...shared,
  test: {
    env: { NODE_ENV: "test" },
    maxWorkers: 2,
    projects: [
      {
        ...own,
        extends: inherit,
        test: { name: "unit", environment: "node", include: ["tests/**/*.spec.ts"] },
      },
      {
        ...own,
        extends: inherit,
        test: {
          name: "integration",
          environment: "node",
          pool: "forks",
          isolate: !worker,
          runner: "./src/test-runner.ts",
          globalSetup: "./src/test-global-setup.ts",
          setupFiles: ["./src/test-setup.ts"],
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
