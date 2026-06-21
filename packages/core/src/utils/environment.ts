export type Environment = "development" | "production" | "test";

/**
 * How the framework hosts your code — the dev server (watcher + HMR) or the
 * bundled production output. A separate axis from {@link Environment}.
 */
export type RuntimeStrategy = "production" | "development";

export function environment(): Environment {
  return (process.env.NODE_ENV as Environment) || "development";
}

export function setEnvironment(env: Environment) {
  process.env.NODE_ENV = env;
}
