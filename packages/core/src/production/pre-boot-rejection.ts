/**
 * Whether an unhandled rejection must end a production process.
 *
 * A rejection before the app has finished booting (a connector failed to
 * boot) leaves a process that is up but serves nothing. Under the production
 * runtime (`node dist/app.js`, started by `warlock start`) that is fatal, so
 * the process manager shows the app as errored. After boot a rejection stays a
 * logged error, and the dev server and tests never exit on one.
 *
 * Reads the production runtime strategy, not `NODE_ENV`, so a production build
 * run with `NODE_ENV=staging` behaves the same.
 *
 * @internal
 */
export function isPreBootRejectionFatal(state: {
  runtimeStrategy: string | undefined;
  isBooted: boolean;
}): boolean {
  return state.runtimeStrategy === "production" && !state.isBooted;
}
