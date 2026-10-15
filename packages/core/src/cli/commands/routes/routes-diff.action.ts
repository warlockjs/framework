import fs from "node:fs";
import path from "node:path";
import { resolveBuildConfig } from "../../../production/resolve-build-config";
import { router } from "../../../router/router";
import type { Route } from "../../../router/types";
import { bootForDiagnostics } from "../doctor/boot-for-diagnostics";
import { comparePageRoutes, diffPageRoutes, type PageRoute } from "./diff-page-routes";

type PageRoutesSnapshot = {
  version: 1;
  routes: PageRoute[];
};

const SNAPSHOT_FILE = "page-routes.manifest.json";

/**
 * What a clean `warlock routes:diff` does and does NOT prove, printed on a
 * clean run so the guarantee is stated where it is relied on.
 */
const CLEAN_RUN_LIMIT =
  "Note: page names are compared as DERIVED by the build, so a clean diff does not prove " +
  "that no route name collided at registration (the router appends `.<method>` to a name " +
  "already claimed by another method). Run `warlock routes` to see the registered names.";

function routeFromLive(route: Route): PageRoute {
  return {
    method: route.method.toUpperCase() as "GET",
    path: route.path,
    name: route.name ?? "",
    source: route.sourceFile ?? "",
  };
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

/**
 * Compare the last successful production page surface with the live dev
 * surface.
 *
 * The comparison itself lives in `diff-page-routes.ts`, which also documents
 * why the route-name method suffix is the one registration-time difference the
 * build-time manifest cannot record — and therefore what a clean run of this
 * command does not prove.
 */
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

  const live = router
    .list()
    .filter((route) => route.isPage)
    .map(routeFromLive)
    .sort(comparePageRoutes);
  const expected = [...snapshot.routes].sort(comparePageRoutes);
  const { changes, removed, added } = diffPageRoutes(expected, live);

  if (changes.length === 0 && removed.length === 0 && added.length === 0) {
    console.log(`Page routes match (${expected.length} routes).`);
    console.log(CLEAN_RUN_LIMIT);
    return;
  }

  for (const { before, after } of changes) {
    printRoute("changed -", before);
    printRoute("        +", after);
  }
  for (const route of removed) printRoute("removed -", route);
  for (const route of added) printRoute("added   +", route);

  throw new Error(
    `Page route drift: ${changes.length} changed, ${removed.length} removed, ${added.length} added. Run \`warlock build\` after reviewing these changes.`,
  );
}
