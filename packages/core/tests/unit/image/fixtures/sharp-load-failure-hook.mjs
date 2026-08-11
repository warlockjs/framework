import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Makes `require("sharp")` fail in a controlled way inside a spawned process.
 *
 * Loaded via `--import` *before* the module under test, so the very first
 * `resolveSharp()` sees the failure this hook injects.
 *
 * The two `MODULE_NOT_FOUND` shapes are **not hand-written**: they are produced
 * by asking Node for a module that genuinely is not there, so the matcher in
 * `resolveSharp()` is tested against Node's real message text rather than
 * against a copy of it that could drift.
 *
 * Modes (env `WARLOCK_SHARP_FAILURE`):
 *
 * - `missing`     — sharp genuinely absent (`Cannot find module 'sharp'`)
 * - `transitive`  — sharp present, a dependency *inside* it absent
 *                   (`Cannot find module 'color'`) — same code, different specifier
 * - `unloadable`  — sharp present but its native binary refuses to load; this is
 *                   sharp's own error, thrown by `node_modules/sharp/lib/sharp.js`
 *                   as a plain `Error` with no `code`
 */

const mode = process.env.WARLOCK_SHARP_FAILURE;

/**
 * A real Node `MODULE_NOT_FOUND`, obtained by resolving `specifier` from a
 * location where it truly cannot be found.
 */
function genuineModuleNotFound(from, specifier) {
  try {
    createRequire(from)(specifier);
  } catch (error) {
    return error;
  }

  throw new Error(`sharp-load-failure-hook is broken: "${specifier}" resolved from ${from}`);
}

/**
 * Faithful copy of the error `node_modules/sharp/lib/sharp.js` throws when every
 * candidate binary fails to load — a plain Error, no `code`, long and actionable.
 */
function unloadableBinaryError() {
  return new Error(
    [
      'Could not load the "sharp" module using the win32-x64 runtime',
      "ERR_DLOPEN_FAILED: \\\\?\\D:\\app\\node_modules\\@img\\sharp-win32-x64\\lib\\sharp-win32-x64.node is not a valid Win32 application.",
      "Possible solutions:",
      "- Ensure optional dependencies can be installed:",
      "    npm install --include=optional sharp",
      "- Ensure your package manager supports multi-platform installation:",
      "    See https://sharp.pixelplumbing.com/install#cross-platform",
      "- Add platform-specific dependencies:",
      "    npm install --os=win32 --cpu=x64 sharp",
      "- Consult the installation documentation:",
      "    See https://sharp.pixelplumbing.com/install",
    ].join("\n"),
  );
}

const failure = (() => {
  switch (mode) {
    case "missing":
      return genuineModuleNotFound(
        path.join(os.tmpdir(), "warlock-sharp-load-failure-fixture.cjs"),
        "sharp",
      );

    case "transitive":
      return genuineModuleNotFound(
        process.env.WARLOCK_SHARP_LIB_ENTRY ?? path.join(os.tmpdir(), "no-sharp.cjs"),
        "color",
      );

    case "unloadable":
      return unloadableBinaryError();

    default:
      throw new Error(`sharp-load-failure-hook: unknown mode ${JSON.stringify(mode)}`);
  }
})();

const originalRequire = Module.prototype.require;

Module.prototype.require = function (specifier, ...rest) {
  if (specifier === "sharp") {
    throw failure;
  }

  return originalRequire.call(this, specifier, ...rest);
};
