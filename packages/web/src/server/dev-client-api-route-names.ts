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

export type DevClientApiRouteInput = {
  router: Router;
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
    () => clientVisibleRouteNames(input.router.getNamedApiRoutes()),
  );
}
