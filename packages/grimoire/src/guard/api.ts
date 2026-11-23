/**
 * The approved public API: the HTTP routes the app serves, kept in
 * `grimoire/approved/api.json` so that any change to them is deliberate.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BookRoute } from "../contracts/adapter";
import type { ApiSnapshot } from "../contracts/guard";
import { GRIMOIRE_PATHS } from "../paths";

/** The sorted route lines of a route list: `GET /orders [auth]`. Page routes are not API. */
export function routeLines(routes: readonly BookRoute[]): string[] {
  const lines = new Set<string>();

  for (const route of routes) {
    if (route.isPage) continue;

    lines.add(`${route.method.toUpperCase()} ${route.path}${route.auth.required ? " [auth]" : ""}`);
  }

  return [...lines].sort();
}

/** An `api.json` text, or `null` when it is not one. */
export function parseApiSnapshot(text: string): ApiSnapshot | null {
  try {
    const parsed = JSON.parse(text) as Partial<ApiSnapshot>;

    if (!Array.isArray(parsed.routes)) return null;

    return {
      schemaVersion: 1,
      approvedAt: typeof parsed.approvedAt === "string" ? parsed.approvedAt : "",
      routes: parsed.routes.filter((line): line is string => typeof line === "string"),
    };
  } catch {
    return null;
  }
}

/** `grimoire/approved/api.json`, or `null` when it was never approved or cannot be read. */
export async function readApiSnapshot(root: string): Promise<ApiSnapshot | null> {
  try {
    return parseApiSnapshot(
      await readFile(path.join(root, ...GRIMOIRE_PATHS.apiSnapshot.split("/")), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Write `grimoire/approved/api.json`. */
export async function writeApiSnapshot(
  root: string,
  routes: readonly string[],
  now: Date = new Date(),
): Promise<ApiSnapshot> {
  const snapshot: ApiSnapshot = {
    schemaVersion: 1,
    approvedAt: now.toISOString(),
    routes: [...routes].sort(),
  };
  const file = path.join(root, ...GRIMOIRE_PATHS.apiSnapshot.split("/"));

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);

  return snapshot;
}

/** The routes added to and removed from the approved list. */
export function diffRoutes(
  approved: readonly string[],
  current: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(approved);
  const after = new Set(current);

  return {
    added: current.filter((line) => !before.has(line)),
    removed: approved.filter((line) => !after.has(line)),
  };
}

/** A short text of a route difference: `added GET /a, removed POST /b`. */
export function describeRouteDiff(diff: { added: string[]; removed: string[] }): string {
  const part = (label: string, lines: string[]): string =>
    lines.length === 0
      ? ""
      : `${label} ${lines.slice(0, 5).join(", ")}${lines.length > 5 ? `, … ${lines.length - 5} more` : ""}`;

  return [part("added", diff.added), part("removed", diff.removed)].filter(Boolean).join("; ");
}
