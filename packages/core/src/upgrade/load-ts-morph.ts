import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { detectPackageManager, type PackageManager } from "../updater/package-manager";
import type { TsMorphModule } from "./types";

/** Thrown when `ts-morph` is not installed; the message says how to add it. */
export class TsMorphMissingError extends Error {
  public override readonly name = "TsMorphMissingError";

  public constructor(public readonly installCommand: string) {
    super(
      `warlock upgrade edits source files with ts-morph, which is not installed. ` +
        `Add it as a development dependency, then run the command again:\n\n  ${installCommand}\n`,
    );
  }
}

/** The dev-dependency install command for `ts-morph` with this package manager. */
export function tsMorphInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm add --save-dev ts-morph";
    case "yarn":
      return "yarn add --dev ts-morph";
    case "bun":
      return "bun add --dev ts-morph";
    default:
      return "npm install --save-dev ts-morph";
  }
}

/**
 * Load `ts-morph` lazily: it is an optional peer of `@warlock.js/core`, needed
 * only by `warlock upgrade`. Resolved from the app first (where the user
 * installs it), then from core's own location.
 */
export async function loadTsMorph(root: string): Promise<TsMorphModule> {
  try {
    const resolved = createRequire(path.join(root, "package.json")).resolve("ts-morph");
    return fromNamespace(await import(pathToFileURL(resolved).href));
  } catch {
    // Not in the app; try core's own resolution below.
  }

  try {
    return fromNamespace(await import("ts-morph"));
  } catch {
    throw new TsMorphMissingError(tsMorphInstallCommand(await detectPackageManager(root)));
  }
}

/** A CommonJS package imported from ESM may expose its API on `default` only. */
function fromNamespace(namespace: unknown): TsMorphModule {
  const candidate = namespace as { Project?: unknown; default?: unknown };
  if (typeof candidate.Project === "function") return namespace as TsMorphModule;
  return candidate.default as TsMorphModule;
}
