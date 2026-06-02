import { colors } from "@mongez/copper";
import dayjs from "dayjs";
import { Path } from "./path";

/**
 * Dev server logger — Vite-style formatting helpers.
 */

function timestamp(): string {
  return colors.dim(`${dayjs().format("HH:mm:ss A")}`);
}

export function devLog(message: string) {
  console.log(`${timestamp()} ${message}`);
}

export function devLogSuccess(message: string) {
  console.log(`${timestamp()} ${colors.green("✓")} ${colors.green(message)}`);
}

/**
 * Colourise a stack trace so the eye lands on *your* code.
 *
 * - Error header (`ReferenceError: x is not defined`) → bold red.
 * - Frames in project `src/` → highlighted: a green `›` pointer, yellow
 *   function name, cyan relative path, dim `:line:col`. These are almost
 *   always where the bug is.
 * - Framework (`@warlock.js`), `node_modules`, and `node:` internal frames
 *   → dimmed and relativised. Still there for context, just out of the way.
 *
 * Source maps are enabled in dev, so the paths/lines here are already the
 * original `.ts` locations — this only changes how they're painted.
 */
export function formatErrorStack(stack: string): string {
  const frame = /^(\s*)at (.+?) \((.+):(\d+):(\d+)\)$/;
  const bareFrame = /^(\s*)at (.+):(\d+):(\d+)$/;
  let headerDone = false;

  return stack
    .split("\n")
    .map(line => {
      const withFn = line.match(frame);
      const bare = line.match(bareFrame);

      if (!withFn && !bare) {
        // Header line(s) before the first frame.
        const painted = headerDone ? colors.dim(line) : colors.bold(colors.red(line));
        return painted;
      }

      headerDone = true;

      const fn = withFn ? withFn[2] : "";
      const file = withFn ? withFn[3] : bare![2];
      const lineNo = withFn ? withFn[4] : bare![3];
      const col = withFn ? withFn[5] : bare![4];

      const isNodeInternal = file.startsWith("node:");
      const isDep = file.includes("node_modules");
      const isFramework = /[\\/]@warlock\.js[\\/]/.test(file);
      const isUserCode = !isNodeInternal && !isDep && !isFramework;

      const rel = isNodeInternal ? file : Path.toRelative(file);
      const loc = `:${lineNo}:${col}`;

      if (isUserCode) {
        return (
          `  ${colors.green("›")} ${colors.dim("at")} ` +
          `${colors.yellow(fn || "<anonymous>")} ` +
          `${colors.cyan(rel)}${colors.dim(loc)}`
        );
      }

      const label = fn ? `at ${fn} ${rel}${loc}` : `at ${rel}${loc}`;
      return `    ${colors.dim(label)}`;
    })
    .join("\n");
}

export function devLogError(message: string, error?: any) {
  console.log(`${timestamp()} ${colors.red("✗")} ${colors.red(message)}`);
  if (error?.stack) console.log(formatErrorStack(error.stack));
}

export function devLogWarn(message: string) {
  console.log(`${timestamp()} ${colors.yellow("⚠")} ${colors.yellow(message)}`);
}

export function devLogInfo(message: string) {
  console.log(`${timestamp()} ${colors.cyan(message)}`);
}

export function devLogDim(message: string) {
  console.log(`${timestamp()} ${colors.dim(message)}`);
}

export function devLogHMR(file: string, dependents?: number) {
  const relativePath = Path.toRelative(file);
  const depInfo = dependents
    ? colors.dim(` +${dependents} module${dependents > 1 ? "s" : ""}`)
    : "";
  console.log(
    `${timestamp()} 🔥 ${colors.green("hmr update")} ${colors.dim(relativePath)}${depInfo}`,
  );
}

export function devLogConfig(file: string, connectors?: string[]) {
  const relativePath = Path.toRelative(file);
  const connectorInfo =
    connectors && connectors.length > 0 ? colors.dim(` → restarting ${connectors.join(", ")}`) : "";
  console.log(
    `${timestamp()} ${colors.cyan("config reload")} ${colors.dim(relativePath)}${connectorInfo}`,
  );
}

export function devLogReady(message: string) {
  console.log(`\n${timestamp()}  ${colors.green("➜")}  ${colors.bold(message)}`);
}

export function devLogSection(title: string) {
  console.log(`\n${timestamp()} ${colors.bold(colors.cyan(title))}`);
}

/**
 * Format ERR_MODULE_NOT_FOUND so the displayed paths are relative to the
 * project root. The loader hook keeps source paths in the URL so we only
 * need to strip the absolute prefix — no cache-path translation any more.
 */
export function formatModuleNotFoundError(error: Error, suggestions?: string[]): string {
  const match = error.message.match(/Cannot find module '([^']+)' imported from '([^']+)'/);
  if (!match) return error.message;

  const [, modulePath, importerPath] = match;
  const lines: string[] = [
    "",
    `${colors.red("❌ MODULE NOT FOUND")}`,
    "",
    `${colors.dim("Cannot find:")} ${colors.cyan(Path.toRelative(modulePath))}`,
    "",
    `${colors.dim("Imported by:")}`,
    `  ${colors.yellow("→")} ${colors.white(Path.toRelative(importerPath))}`,
  ];

  if (suggestions && suggestions.length > 0) {
    lines.push("");
    lines.push(`${colors.dim("Did you mean?")}`);
    suggestions.forEach(s => lines.push(`  ${colors.cyan("→")} ${colors.green(s)}`));
  }

  lines.push("");
  return lines.join("\n");
}

/** @deprecated alias retained for older callers. Use `devLog` directly. */
export const devServeLog = devLog;
