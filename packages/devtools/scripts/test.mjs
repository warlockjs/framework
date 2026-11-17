import { runSteps } from "./run-steps.mjs";

// The server specs, then the dashboard specs (jsdom).
runSteps([
  ["vitest/vitest.mjs", "run"],
  ["vitest/vitest.mjs", "run", "--config", "vitest.ui.config.ts"],
]);
