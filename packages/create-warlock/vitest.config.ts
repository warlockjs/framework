import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { web: fileURLToPath(new URL("./templates/design-system/src/web", import.meta.url)) },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    globals: false,
    include: ["{specs,tests}/**/*.spec.ts"],
    // Many specs generate a real scaffold app and run tooling (Oxlint) over it —
    // inherently slow (~11s each) and slower still when the release gate builds
    // all 28 packages concurrently. 20s was too tight and flaked under gate load;
    // a higher cap only bites a genuine hang, never a passing test.
    testTimeout: 120_000,
  },
});
