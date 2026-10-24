import type { ReleaseCheck, ReleaseConfig, ResolvedReleaseConfig } from "./types";

const DEFAULT_CHECKS: ReleaseCheck[] = [
  { name: "typecheck", command: "npx warlock typecheck" },
  { name: "check", command: "npx warlock check" },
  { name: "test", command: "npx warlock test" },
  { name: "build", command: "NODE_ENV=production npx warlock build" },
];

/**
 * Fill every default of the `release` config.
 *
 * Rejects settings that would make a later step guess: a check without a
 * name or command, and duplicate check names.
 */
export function resolveReleaseConfig(raw: ReleaseConfig = {}): ResolvedReleaseConfig {
  const checks = raw.gate?.checks ?? DEFAULT_CHECKS;
  const seen = new Set<string>();

  for (const check of checks) {
    if (!check.name || !check.command) {
      throw new Error("Every release.gate check needs a `name` and a `command`.");
    }

    if (seen.has(check.name)) {
      throw new Error(`release.gate has two checks named "${check.name}".`);
    }

    seen.add(check.name);
  }

  return {
    directory: raw.directory ?? ".warlock",
    distDir: raw.distDir ?? "dist",
    include: raw.include ?? [],
    linkNodeModules: raw.linkNodeModules ?? true,
    checks,
    migrations: raw.migrations ?? {},
    restart: {
      command: raw.restart?.command,
      timeoutMs: raw.restart?.timeoutMs ?? 120_000,
    },
    verify: {
      url: raw.verify?.url,
      expectedStatus: raw.verify?.expectedStatus ?? 200,
      retries: raw.verify?.retries ?? 5,
      intervalMs: raw.verify?.intervalMs ?? 2000,
      timeoutMs: raw.verify?.timeoutMs ?? 5000,
      versionPath: raw.verify?.versionPath ?? "version",
      commitPath: raw.verify?.commitPath ?? "commit",
      match: raw.verify?.match ?? ["version", "commit"],
    },
  };
}
