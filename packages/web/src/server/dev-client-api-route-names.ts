/**
 * Development's answer to "which named API routes may this page embed?".
 *
 * Production reads the list the build baked into the page manifest. Development
 * has no build, so it asks the same question per request through
 * `createClientApiRouteResolver` (`build/client-api-routes.ts`): the same walk
 * over the same modules, re-run only when one of the files it read has changed,
 * and the route names read from the live router so a route reload is seen too.
 *
 * Imports nothing from Vite at runtime; the sources are read from disk, the way
 * the build reads them.
 */
import type { Router } from "@warlock.js/core";
import {
  createClientApiRouteResolver,
  type ClientApiRouteModule,
} from "../build/client-api-routes";
import { isFile } from "../build/discover-pages";
import { pageSetupFileFor } from "../build/page-setup-file";
import { appConventionAliases } from "../vite/app-convention-aliases";
import { clientVisibleRouteNames } from "../routing/named-api-routes";

/**
 * Where the browser route table's names come from: Core's REAL router
 * registry. A multi-site install's per-site registration facade does not
 * implement it and must never be passed here.
 */
export type NamedApiRouteRegistry = Pick<Router, "getNamedApiRoutes">;

export type DevClientApiRouteInput = {
  registry: NamedApiRouteRegistry;
  /** The application's `src` directory: the root of the `web/*` and `app/*` aliases. */
  appSrcRoot: string;
  /** The global application root component file. */
  appFile: string;
  /** The page's layout chain, outermost first. */
  layoutFiles?: readonly string[];
  /** The page module (or the not-found page). */
  pageFile: string;
  /** The application's error page, when it has one: it can render for any page. */
  errorPageFile?: string;
};

/** The per-request route-name function for one page document in development. */
export function devClientApiRouteNames(input: DevClientApiRouteInput): () => readonly string[] {
  // A site registration facade slipped in through a cast would otherwise fail
  // on the first request; fail at install with the cause named.
  if (typeof input.registry?.getNamedApiRoutes !== "function") {
    throw new TypeError(
      "devClientApiRouteNames needs Core's router registry (getNamedApiRoutes); a site registration router cannot supply named API routes.",
    );
  }

  const moduleOf = (file: string): ClientApiRouteModule => {
    const setupFile = pageSetupFileFor(file);
    return setupFile !== undefined && isFile(setupFile) ? { file, setupFile } : { file };
  };
  const files = [
    input.appFile,
    ...(input.layoutFiles ?? []),
    input.pageFile,
    ...(input.errorPageFile === undefined ? [] : [input.errorPageFile]),
  ];

  return createClientApiRouteResolver(
    { modules: files.map(moduleOf), aliases: appConventionAliases(input.appSrcRoot) },
    () => clientVisibleRouteNames(input.registry.getNamedApiRoutes()),
  );
}
