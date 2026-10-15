import { get } from "@mongez/reinforcements";
import type { WarlockConfig } from "./types";

/**
 * Keys of `warlock.config.ts` that are declared but never read, and where the
 * setting lives instead.
 */
export const deprecatedConfigKeys: Record<string, string> = {
  "server.port": "set the HTTP port in `config/http.ts` (`port`)",
  "server.host": "set the HTTP host in `config/http.ts` (`host`)",
  "server.retryOtherPort": "port fallback is not implemented, remove it",
  "tests.include": "configure test discovery in `config/tests.ts`",
  "tests.exclude": "configure test discovery in `config/tests.ts`",
};

/**
 * Build one warning per deprecated key the app actually sets.
 */
export function getDeprecatedConfigWarnings(config: WarlockConfig | undefined): string[] {
  if (!config) return [];

  return Object.entries(deprecatedConfigKeys)
    .filter(([key]) => get(config, key) !== undefined)
    .map(
      ([key, instead]) =>
        `warlock.config.ts: \`${key}\` is deprecated and ignored by the framework; ${instead}.`,
    );
}
