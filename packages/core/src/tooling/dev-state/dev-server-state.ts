import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Where `warlock dev` records the address of the running server, under the project root. */
export const DEV_SERVER_STATE_FILE = ".warlock/dev-server.json";

/**
 * What a running `warlock dev` worker records about itself, so `warlock trace`
 * and `warlock mcp` can find it without guessing a port.
 *
 * Written once the server is ready, rewritten when `--mcp` starts, and removed
 * when the worker shuts down. A crashed worker can leave a stale file behind,
 * so readers confirm the server answers before trusting it.
 */
export type DevServerState = {
  schemaVersion: 1;
  /** The worker process id (informational: readers never signal it). */
  pid: number;
  /** The address to send requests to, e.g. `http://localhost:2030`. */
  url: string;
  /** ISO time the worker became ready. */
  startedAt: string;
  /** The devtools mount, when `@warlock.js/devtools` was registered. */
  devtools: { path: string } | null;
  /** The MCP endpoint `warlock dev --mcp` serves, when it is on. */
  mcp: { url: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statePath(cwd: string): string {
  return path.join(cwd, DEV_SERVER_STATE_FILE);
}

/** Narrow parsed JSON to a {@link DevServerState}; `undefined` for anything else. */
export function parseDevServerState(value: unknown): DevServerState | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  if (typeof value.url !== "string" || typeof value.pid !== "number") return undefined;

  const devtools =
    isRecord(value.devtools) && typeof value.devtools.path === "string"
      ? { path: value.devtools.path }
      : null;
  const mcp =
    isRecord(value.mcp) && typeof value.mcp.url === "string" ? { url: value.mcp.url } : null;

  return {
    schemaVersion: 1,
    pid: value.pid,
    url: value.url,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    devtools,
    mcp,
  };
}

/** The recorded state, or `undefined` when no dev server recorded one. */
export function readDevServerState(cwd = process.cwd()): DevServerState | undefined {
  const file = statePath(cwd);

  if (!existsSync(file)) return undefined;

  try {
    return parseDevServerState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

/** Record the state atomically (temp file + rename), creating `.warlock/` when needed. */
export function writeDevServerState(state: DevServerState, cwd = process.cwd()): void {
  const file = statePath(cwd);
  const temporary = `${file}.${process.pid}.tmp`;

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

/** Merge fields into the recorded state; a no-op when there is none. */
export function updateDevServerState(
  patch: Partial<Omit<DevServerState, "schemaVersion">>,
  cwd = process.cwd(),
): void {
  const current = readDevServerState(cwd);

  if (!current) return;

  writeDevServerState({ ...current, ...patch }, cwd);
}

/**
 * Remove the state file — only when it still belongs to `pid`, so a worker
 * that shuts down late never deletes the record of the worker that replaced it.
 */
export function removeDevServerState(pid = process.pid, cwd = process.cwd()): void {
  const current = readDevServerState(cwd);

  if (current && current.pid !== pid) return;

  rmSync(statePath(cwd), { force: true });
}
