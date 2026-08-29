import fs from "node:fs";
import path from "node:path";
import { resolveBuildConfig } from "../../../production/resolve-build-config";
import { router } from "../../../router/router";
import type { Route } from "../../../router/types";
import { bootForDiagnostics } from "../doctor/boot-for-diagnostics";

type PageRoute = {
  method: "GET";
  path: string;
  name: string;
  source: string;
};

type PageRoutesSnapshot = {
  version: 1;
  routes: PageRoute[];
};

const SNAPSHOT_FILE = "page-routes.manifest.json";

function routeFromLive(route: Route): PageRoute {
  return {
    method: route.method.toUpperCase() as "GET",
    path: route.path,
    name: route.name ?? "",
    source: route.sourceFile ?? "",
  };
}

function compare(left: PageRoute, right: PageRoute): number {
  return left.path.localeCompare(right.path) || left.name.localeCompare(right.name);
}

function snapshotPath(): string {
  return path.join(resolveBuildConfig().outdir, SNAPSHOT_FILE);
}

function readSnapshot(file: string): PageRoutesSnapshot {
  let raw: string;

  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    throw new Error(
      `Cannot compare page routes: no build snapshot exists at "${file}". Run \`warlock build\` successfully, then run \`warlock routes:diff\` again.`,
    );
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { routes?: unknown }).routes) ||
      !(parsed as { routes: unknown[] }).routes.every(
        (route) =>
          typeof route === "object" &&
          route !== null &&
          (route as PageRoute).method === "GET" &&
          typeof (route as PageRoute).path === "string" &&
          typeof (route as PageRoute).name === "string" &&
          typeof (route as PageRoute).source === "string",
      )
    ) {
      throw new Error("invalid shape");
    }

    return parsed as PageRoutesSnapshot;
  } catch {
    throw new Error(
      `Cannot compare page routes: build snapshot "${file}" is malformed. Run \`warlock build\` successfully to replace it, then retry.`,
    );
  }
}

function printRoute(prefix: string, route: PageRoute): void {
  const source = route.source ? ` (${route.source})` : "";
  console.log(`${prefix} GET ${route.path}  ${route.name}${source}`);
}

/** Compare the last successful production page surface with the live dev surface. */
export async function routesDiffCommandAction(): Promise<void> {
  const snapshot = readSnapshot(snapshotPath());
  const context = await bootForDiagnostics();

  if (
    !context.booted ||
    context.moduleFailures.length > 0 ||
    context.connectors.failures.length > 0 ||
    context.connectors.registrationError !== undefined
  ) {
    const details = [
      ...context.moduleFailures.map(({ file, message }) => `${file}: ${message}`),
      ...context.connectors.failures.map(({ name, message }) => `${name}: ${message}`),
      ...(context.connectors.registrationError ? [context.connectors.registrationError] : []),
    ];
    throw new Error(
      `Cannot compare page routes because diagnostic boot failed.${details.length ? `\n${details.join("\n")}` : ""}`,
    );
  }

  const live = router.list().filter((route) => route.isPage).map(routeFromLive).sort(compare);
  const expected = [...snapshot.routes].sort(compare);
  const remainingExpected = new Set(expected);
  const remainingLive = new Set(live);
  const changes: Array<{ before: PageRoute; after: PageRoute }> = [];

  // Exact route identity is the comparison contract. A differing source is
  // displayed only as context and must not make an otherwise identical route
  // drift (a checkout can be relocated without changing its surface).
  for (const before of expected) {
    const after = live.find(
      (candidate) =>
        remainingLive.has(candidate) &&
        candidate.method === before.method &&
        candidate.path === before.path &&
        candidate.name === before.name,
    );

    if (after) {
      remainingExpected.delete(before);
      remainingLive.delete(after);
    }
  }

  // A stable source is diagnostic context, never itself a diff. It only groups
  // a changed page into one useful line instead of a removal plus an addition.
  for (const before of remainingExpected) {
    const after = [...remainingLive].find(
      (candidate) =>
        remainingLive.has(candidate) && candidate.source !== "" && candidate.source === before.source,
    );

    if (after && (before.path !== after.path || before.name !== after.name)) {
      changes.push({ before, after });
      remainingExpected.delete(before);
      remainingLive.delete(after);
    }
  }

  const removed = [...remainingExpected].sort(compare);
  const added = [...remainingLive].sort(compare);

  if (changes.length === 0 && removed.length === 0 && added.length === 0) {
    console.log(`Page routes match (${expected.length} routes).`);
    return;
  }

  for (const { before, after } of changes.sort((left, right) => compare(left.before, right.before))) {
    printRoute("changed -", before);
    printRoute("        +", after);
  }
  for (const route of removed) printRoute("removed -", route);
  for (const route of added) printRoute("added   +", route);

  throw new Error(
    `Page route drift: ${changes.length} changed, ${removed.length} removed, ${added.length} added. Run \`warlock build\` after reviewing these changes.`,
  );
}
