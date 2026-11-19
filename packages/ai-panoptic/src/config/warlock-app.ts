import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The global key `@warlock.js/devtools` publishes once its dashboard is
 * mounted (`{ path, mode }`). Spelled out here so Panoptic never imports
 * devtools.
 */
export const DEVTOOLS_MOUNTED_KEY = Symbol.for("@warlock.js/devtools.mounted");

/** Where the check looks; injectable for specs. */
export type WarlockAppProbe = {
  cwd?: () => string;
  env?: Readonly<Record<string, string | undefined>>;
  exists?: (path: string) => boolean;
  global?: Record<PropertyKey, unknown>;
};

const CONFIG_FILES = [
  "warlock.config.ts",
  "warlock.config.js",
  "warlock.config.mjs",
  "warlock.config.cjs",
];

/**
 * Whether this process is a Warlock app: devtools published its marker,
 * `warlock start` set `WARLOCK_BOOT_SIGNAL`, or a `warlock.config.ts`
 * (`.js`, `.mjs`, `.cjs`) sits in the working directory. Never throws.
 */
export function isInsideWarlockApp(probe: WarlockAppProbe = {}): boolean {
  try {
    const globals = probe.global ?? (globalThis as unknown as Record<PropertyKey, unknown>);

    if (globals[DEVTOOLS_MOUNTED_KEY]) {
      return true;
    }

    const env = probe.env ?? process.env;

    if (env.WARLOCK_BOOT_SIGNAL) {
      return true;
    }

    const cwd = (probe.cwd ?? (() => process.cwd()))();
    const exists = probe.exists ?? existsSync;

    return CONFIG_FILES.some((file) => exists(join(cwd, file)));
  } catch {
    return false;
  }
}

/**
 * The devtools path to point at: the marker's `path` when devtools is
 * mounted, otherwise `/__warlock`.
 */
export function devtoolsPathHint(probe: WarlockAppProbe = {}): string {
  try {
    const globals = probe.global ?? (globalThis as unknown as Record<PropertyKey, unknown>);
    const marker = globals[DEVTOOLS_MOUNTED_KEY] as { path?: unknown } | undefined;

    if (marker && typeof marker.path === "string" && marker.path !== "") {
      return marker.path;
    }
  } catch {
    // fall through to the default
  }

  return "/__warlock";
}
