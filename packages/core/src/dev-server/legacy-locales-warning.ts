import { log } from "@warlock.js/logger";

let warned = false;

/** Warn once per dev-server process when legacy locale modules are loaded. */
export function warnForLegacyLocales(localeFiles: readonly string[]): void {
  const legacyFiles = localeFiles.filter((file) => /\/utils\/locales\.(ts|tsx)$/.test(file));
  if (warned || legacyFiles.length === 0) return;

  warned = true;
  const count = legacyFiles.length;
  log.warn(
    "localization",
    "legacy-locales",
    `${count} legacy utils/locales.ts ${count === 1 ? "file is" : "files are"} auto-loaded. ` +
      "Run `warlock doctor --fix` to migrate them; auto-loaded locales.ts is removed in v6.",
  );
}

/** Test-only reset for the process-scoped warning guard. */
export function resetLegacyLocalesWarningForTests(): void {
  warned = false;
}
