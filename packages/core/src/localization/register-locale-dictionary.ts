import config from "@mongez/config";
import {
  getTranslationsList,
  groupedTranslations,
  setTranslationsList,
} from "@mongez/localization";
import { parseLocaleDictionary } from "./parse-locale-dictionary";

type Owner = { sourceFile: string; kind: "json" | "ts" };
const owners = new Map<string, Owner>();
const keysBySource = new Map<string, string[]>();

function claim(sourceFile: string, kind: Owner["kind"], keys: readonly string[]): void {
  for (const key of keys) {
    const owner = owners.get(key);
    if (owner && owner.sourceFile !== sourceFile)
      throw new Error(
        `Translation key "${key}" is owned by both "${owner.sourceFile}" and "${sourceFile}".`,
      );
  }
  for (const key of keys) owners.set(key, { sourceFile, kind });
  keysBySource.set(sourceFile, [...keys]);
}

export function registerGroupedTranslationKeys(sourceFile: string, keys: readonly string[]): void {
  claim(sourceFile, "ts", keys);
}

/** Undo JSON entries during HMR while preserving unrelated global translations. */
export function unregisterLocaleDictionary(sourceFile: string): void {
  const keys = keysBySource.get(sourceFile) ?? [];
  keysBySource.delete(sourceFile);
  for (const key of keys) owners.delete(key);
  const translations = getTranslationsList();
  for (const key of keys)
    for (const locale of Object.keys(translations)) {
      const segments = key.split(".");
      let target: Record<string, unknown> | undefined = translations[locale] as Record<
        string,
        unknown
      >;
      for (const segment of segments.slice(0, -1)) {
        const next = target?.[segment];
        if (!next || typeof next !== "object") {
          target = undefined;
          break;
        }
        target = next as Record<string, unknown>;
      }
      if (target) delete target[segments.at(-1)!];
    }
  setTranslationsList(translations);
}

export function registerLocaleDictionary(input: {
  sourceFile: string;
  source: string;
  defaultNamespace: string;
}): () => void {
  unregisterLocaleDictionary(input.sourceFile);
  const localeCodes = config.get("app.localeCodes");
  const parsed = parseLocaleDictionary({
    ...input,
    localeCodes: Array.isArray(localeCodes) ? localeCodes : undefined,
  });
  const keys = Object.keys(parsed.entries);
  claim(input.sourceFile, "json", keys);
  groupedTranslations(parsed.entries);
  return () => unregisterLocaleDictionary(input.sourceFile);
}
