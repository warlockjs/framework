/**
 * Thrown when a seeder's `dependsOn` references a seeder name that is not
 * registered with the manager. Surfaces the offending dependent + the missing
 * dependency so the misconfiguration is obvious without spelunking.
 */
export class UnknownSeederDependencyError extends Error {
  /** Stable Warlock error code; `warlock explain WL6001` prints the fix. */
  public readonly code = "WL6001";

  public constructor(
    public readonly seeder: string,
    public readonly dependency: string,
  ) {
    super(
      `Seeder "${seeder}" depends on "${dependency}", but no seeder with that name is registered.`,
    );
    this.name = "UnknownSeederDependencyError";
  }
}

/**
 * Thrown when the `dependsOn` graph contains a cycle, which would make a
 * deterministic run order impossible. Carries the cycle path for diagnosis.
 */
export class SeederDependencyCycleError extends Error {
  /** Stable Warlock error code; `warlock explain WL6002` prints the fix. */
  public readonly code = "WL6002";

  public constructor(public readonly cycle: string[]) {
    super(`Seeder dependency cycle detected: ${cycle.join(" -> ")}`);
    this.name = "SeederDependencyCycleError";
  }
}
