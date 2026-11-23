/**
 * The app's languages and how its URLs carry them, read without booting the
 * app: from the config already loaded in the process when there is one, else
 * from the string literals in `src/config/app.ts` and `src/config/web.ts`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** How a page URL carries the language (`web.localeRouting.strategy`). */
export type LocaleStrategy = "none" | "prefix" | "prefix-except-default";

const STRATEGIES: readonly LocaleStrategy[] = ["none", "prefix", "prefix-except-default"];

async function readConfigFile(root: string, name: string): Promise<string> {
  for (const extension of ["ts", "js", "mjs", "mts"]) {
    try {
      return await readFile(path.join(root, "src", "config", `${name}.${extension}`), "utf8");
    } catch {
      // Try the next extension.
    }
  }

  return "";
}

/** The config value already loaded in this process, or `undefined`. */
async function loadedConfig(key: string): Promise<unknown> {
  try {
    const core = await import("@warlock.js/core");

    return core.config.key(key);
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

/** The string literals of `localeCodes: ["en", "ar"]`. */
function literalCodes(source: string): string[] {
  const match = /\blocaleCodes\s*:\s*\[([^\]]*)\]/.exec(source);

  if (!match) return [];

  return [...(match[1] ?? "").matchAll(/["'`]([^"'`]+)["'`]/g)].flatMap((code) =>
    code[1] ? [code[1]] : [],
  );
}

/** The app's language codes in order (`["en", "ar"]`), or `[]` when it names none. Never boots the app. */
export async function readAppLanguages(root: string): Promise<string[]> {
  const loaded = stringArray(await loadedConfig("app.localeCodes"));

  if (loaded !== null) return loaded;

  return literalCodes(await readConfigFile(root, "app"));
}

/** The default language: `localeCode` of the loaded config, else its literal (or the `env()` fallback) in `app.ts`, else the first code. */
async function defaultLanguage(root: string, languages: readonly string[]): Promise<string> {
  const loaded = await loadedConfig("app.localeCode");

  if (typeof loaded === "string" && loaded !== "") return loaded;

  const match = /\blocaleCode\s*:\s*(?:env\(\s*["'`][^"'`]*["'`]\s*,\s*)?["'`]([^"'`]+)["'`]/.exec(
    await readConfigFile(root, "app"),
  );

  return match?.[1] ?? languages[0] ?? "";
}

/** How a page URL carries the language, and the default language. */
export async function readLocaleRouting(
  root: string,
  languages: readonly string[],
): Promise<{ strategy: LocaleStrategy; defaultLanguage: string }> {
  const loaded = await loadedConfig("web.localeRouting");
  const loadedStrategy =
    typeof loaded === "object" && loaded !== null
      ? (loaded as { strategy?: unknown }).strategy
      : undefined;
  const written = /\blocaleRouting\s*:\s*\{[^}]*?\bstrategy\s*:\s*["'`]([^"'`]+)["'`]/.exec(
    await readConfigFile(root, "web"),
  )?.[1];
  const candidate = loadedStrategy ?? written;
  const strategy = STRATEGIES.find((value) => value === candidate) ?? "none";

  return { strategy, defaultLanguage: await defaultLanguage(root, languages) };
}

/** The URL path of `pagePath` in `language` under the routing strategy. */
export function localizedPath(
  pagePath: string,
  language: string,
  routing: { strategy: LocaleStrategy; defaultLanguage: string },
): string {
  const normal = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;

  if (
    language === "" ||
    routing.strategy === "none" ||
    (routing.strategy === "prefix-except-default" && language === routing.defaultLanguage)
  ) {
    return normal;
  }

  return `/${language}${normal === "/" ? "" : normal}`;
}
