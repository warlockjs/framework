/**
 * `@warlock.js/core/tooling` — the machine-readable side of the CLI, as
 * functions: `inspectApp()` (what `warlock inspect` prints), `runCheck()`
 * (`warlock check`), `runTypecheck()` (`warlock typecheck`), and the shared
 * problem shape every one of them reports.
 *
 * A separate entry because it pulls in the TypeScript compiler and ESLint,
 * which must not reach an app's production module graph through the root
 * barrel. Error codes are on `@warlock.js/core/errors` (and the root).
 */
export * from "./check";
export * from "./inspect";
export {
  createProblem,
  type ProblemInput,
  type ProblemSource,
  type ToolingProblem,
} from "./problem";
export * from "./typecheck";
