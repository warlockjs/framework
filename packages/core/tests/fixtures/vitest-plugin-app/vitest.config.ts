import { defineConfig } from "vitest/config";
import { lowerStage3Decorators } from "../../../src/vite/lower-stage3-decorators";

// The layout apps carried over from Vitest 4: the plugin in the root config and
// again in every inline project. Since Vitest 5 an inline project extends the
// root config by default, so the project lists a plugin it already inherits.
export default defineConfig({
  plugins: [lowerStage3Decorators()],
  test: {
    projects: [
      {
        plugins: [lowerStage3Decorators()],
        test: { name: "http", environment: "node", include: ["tests/a.test.ts"] },
      },
      {
        plugins: [lowerStage3Decorators()],
        test: { name: "isolated", environment: "node", include: ["tests/b.test.ts"] },
      },
    ],
  },
});
