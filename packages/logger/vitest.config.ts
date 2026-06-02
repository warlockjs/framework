import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Sibling workspace package consumed as source in this monorepo. Mirrors
      // the root tsconfig `paths` mapping so the file-based channels resolve
      // `@warlock.js/fs` when the suite runs standalone from this directory.
      "@warlock.js/fs": fileURLToPath(new URL("../fs/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.spec.ts"],
  },
});
