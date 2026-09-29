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

function parseFrame(frame: string): DevtoolsCallerLocation | undefined {
  const match = frame.match(/\bat\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
  const [, rawFile, line, column] = match ?? [];
  if (!rawFile || !line || !column) return undefined;
  const file = normalizePath(rawFile);
  return { file, line: Number(line), column: Number(column) };
}

/** A drive-letter file URL names a Windows path on whichever host decodes it. */
const WINDOWS_DRIVE_FILE_URL = /^file:\/\/\/[A-Za-z]:/;

function normalizePath(path: string): string {
  const decoded = !path.startsWith("file:")
    ? path
    : WINDOWS_DRIVE_FILE_URL.test(path)
      ? fileURLToPath(path, { windows: true })
      : fileURLToPath(path);
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
