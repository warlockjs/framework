import { fileURLToPath } from "node:url";

import type { DevtoolsCallerLocation } from "./types";

const packageDirectory = normalizePath(fileURLToPath(new URL("../", import.meta.url)));

/** Returns the first non-runtime, non-devtools frame in a V8 stack trace. */
export function captureCallerLocation(
  stack: string = new Error().stack ?? "",
): DevtoolsCallerLocation | undefined {
  for (const line of stack.split("\n")) {
    const frame = parseFrame(line);
    if (!frame || shouldSkip(frame.file)) continue;
    return frame;
  }
  return undefined;
}

function parseFrame(line: string): DevtoolsCallerLocation | undefined {
  const match = line.match(/\bat\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
  if (!match) return undefined;
  const file = normalizePath(match[1]);
  return { file, line: Number(match[2]), column: Number(match[3]) };
}

function normalizePath(path: string): string {
  const decoded = path.startsWith("file:") ? fileURLToPath(path) : path;
  return decoded.replace(/\\/g, "/");
}

function shouldSkip(file: string): boolean {
  return (
    file.startsWith("node:") ||
    file.includes("/node_modules/") ||
    // Node's own frames (`node:internal/…`, or bare `internal/…` on older
    // runtimes); an app folder named `internal` is still an app frame.
    file.startsWith("internal/") ||
    file.startsWith(packageDirectory)
  );
}
