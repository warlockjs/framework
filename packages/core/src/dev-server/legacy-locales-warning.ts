import { log } from "@warlock.js/logger";

let warned = false;

/** Warn once per process, naming every legacy `utils/locales.ts` file, when legacy locale modules are loaded. */
export function warnForLegacyLocales(localeFiles: readonly string[]): void {
  const legacyFiles = localeFiles.filter((file) => /\/utils\/locales\.(ts|tsx)$/.test(file));
  if (warned || legacyFiles.length === 0) return;

  warned = true;
  const count = legacyFiles.length;
  log.warn(
    "localization",
    "legacy-locales",
    `${count} legacy utils/locales.ts ${count === 1 ? "file is" : "files are"} deprecated and still auto-loaded: ` +
      `${legacyFiles.join(", ")}. ` +
      "Run `warlock doctor --fix` to move them into the module's utils/locales.json (or utils/locales/<feature>.json); auto-loaded locales.ts is removed in v6.",
  );
}

/** Test-only reset for the process-scoped warning guard. */
export function resetLegacyLocalesWarningForTests(): void {
  warned = false;
}
