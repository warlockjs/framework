/**
 * `grimoire/settings.md`: front matter only (languages, screenshot mode, code
 * rules, protected areas). `parseSettings` reads the file; `resolveSettings`
 * fills the defaults and the app's own languages in.
 */
import {
  CODE_RULES,
  DEFAULT_GRIMOIRE_SETTINGS,
  DEFAULT_PROTECTED_AREAS,
  SCREENSHOT_MODES,
  type CodeRuleName,
  type GrimoireSettings,
  type ProtectedArea,
  type ScreenshotMode,
  type WrittenSettings,
} from "../contracts/settings";
import type { Located } from "../contracts/location";
import { FrontMatterReader } from "./fields";
import { lineAt, readDocument } from "./markdown";
import type { FindingSink } from "./sink";

/** A language code: `en`, `ar`, `pt-BR`. */
const LANGUAGE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/;

/** Read `grimoire/settings.md`. GR1004 for a wrong value, GR1005 for a key it does not read. */
export function parseSettings(file: string, text: string, sink: FindingSink): WrittenSettings {
  const document = readDocument(file, text, "none", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(["languages", "screenshots", "rules", "protected"], "settings");

  const languages = fields.list("languages", {
    required: false,
    check: (value) => (LANGUAGE.test(value) ? null : "write a language code like en or pt-BR"),
  });
  const screenshots = fields.optionalOneOf<ScreenshotMode>("screenshots", SCREENSHOT_MODES);
  const rules: Located<CodeRuleName>[] | null = fields.has("rules")
    ? fields
        .list("rules", {
          required: false,
          check: (value) =>
            (CODE_RULES as readonly string[]).includes(value)
              ? null
              : `use one of: ${CODE_RULES.join(", ")}`,
        })
        .map((rule) => ({ value: rule.value as CodeRuleName, at: rule.at }))
    : null;
  const protectedAreas: WrittenSettings["protected"] = [];

  for (const line of fields.list("protected", {
    required: false,
    check: (value) =>
      value.trim().split(/\s+/).length >= 2 ? null : "write `<name> <glob> [<glob>…]`",
  })) {
    const [name = "", ...globs] = line.value.trim().split(/\s+/);

    protectedAreas.push({ name, globs, at: line.at ?? lineAt(file, 1) });
  }

  return { file, languages, screenshots, rules, protected: protectedAreas };
}

/**
 * The settings every reader uses.
 *
 * @param written The parsed file, or `null` when the project has none.
 * @param adapterLanguages What the adapter's `languages()` reported (empty when it has none).
 */
export function resolveSettings(
  written: WrittenSettings | null,
  adapterLanguages: readonly string[] = [],
): GrimoireSettings {
  const writtenLanguages = written?.languages.map((language) => language.value) ?? [];
  const languages = writtenLanguages.length > 0 ? writtenLanguages : [...adapterLanguages];
  const areas: ProtectedArea[] = DEFAULT_PROTECTED_AREAS.map((area) => ({
    name: area.name,
    globs: [...area.globs],
  }));

  for (const line of written?.protected ?? []) {
    const existing = areas.find((area) => area.name === line.name);

    if (existing) existing.globs = [...line.globs];
    else areas.push({ name: line.name, globs: [...line.globs] });
  }

  return {
    file: written?.file ?? null,
    languages: [...new Set(languages)],
    languagesFrom:
      writtenLanguages.length > 0 ? "settings" : adapterLanguages.length > 0 ? "adapter" : "none",
    screenshots: written?.screenshots?.value ?? DEFAULT_GRIMOIRE_SETTINGS.screenshots,
    rules:
      written?.rules === null || written === null ? null : written.rules.map((rule) => rule.value),
    protected: areas,
  };
}
