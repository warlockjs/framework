import baseConfig from "@mongez/config";
import { existsSync } from "node:fs";
import path from "node:path";
import type { InspectConfigKey } from "./inspect-report.types";

/** How deep nested config objects are walked. Deeper keys are reported as `object`. */
const MAX_DEPTH = 4;

/** Extensions a `src/config/<name>` file may have. */
const CONFIG_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/** The JS type of a config value, without the value. */
export function configValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof RegExp) return "regexp";
  if (value instanceof Date) return "date";
  if (isPlainObject(value)) return "object";

  if (typeof value === "object") {
    const constructorName = Reflect.get(Object.getPrototypeOf(value) ?? {}, "constructor");

    return typeof constructorName === "function" && constructorName.name
      ? constructorName.name
      : "object";
  }

  return typeof value;
}

function configFileFor(cwd: string, section: string): string | null {
  for (const extension of CONFIG_EXTENSIONS) {
    const relative = `src/config/${section}${extension}`;

    if (existsSync(path.join(cwd, relative))) return relative;
  }

  return null;
}

/**
 * Every loaded config key as a dotted path with its type — NEVER its value,
 * because config holds secrets. Plain objects are walked up to
 * {@link MAX_DEPTH} levels; arrays, class instances and functions are leaves.
 *
 * @param cwd Project root, used to name the `src/config/*` file of each section.
 * @param source The loaded config tree; defaults to everything `config` holds.
 */
export function collectConfig(cwd: string, source?: Record<string, unknown>): InspectConfigKey[] {
  const tree: unknown = source ?? baseConfig.list();
  const keys: InspectConfigKey[] = [];

  if (!isPlainObject(tree)) return keys;

  const walk = (value: unknown, prefix: string, depth: number, file: string | null) => {
    if (isPlainObject(value) && depth < MAX_DEPTH && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, `${prefix}.${key}`, depth + 1, file);
      }

      return;
    }

    keys.push({ key: prefix, type: configValueType(value), file });
  };

  for (const [section, value] of Object.entries(tree)) {
    const file = configFileFor(cwd, section);

    if (isPlainObject(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, `${section}.${key}`, 2, file);
      }
    } else {
      keys.push({ key: section, type: configValueType(value), file });
    }
  }

  return keys.sort((first, second) => first.key.localeCompare(second.key));
}
