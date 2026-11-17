import { runSteps } from "./run-steps.mjs";

// The server sources, then the dashboard sources (their own tsconfig).
runSteps([
  ["typescript/bin/tsc", "--noEmit"],
  ["typescript/bin/tsc", "--noEmit", "-p", "ui-src/tsconfig.json"],
]);
