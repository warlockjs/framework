import { connectorsManager } from "../connectors/connectors-manager";
import type { Connector } from "../connectors/types";
import { devLogWarn } from "./dev-logger";

const DEVTOOLS_PACKAGE = "@warlock.js/devtools";

type DevtoolsModule = {
  devtoolsConnector?: () => Connector;
};

/**
 * Register `@warlock.js/devtools` when the app has it installed.
 *
 * Called by `warlock dev` only, before the late connector phase, so the app
 * never names devtools in `warlock.config.ts`. That matters because devtools
 * is a DEV dependency: a production install omits it, and a config import of
 * it would fail to resolve there. The production entry never calls this.
 *
 * Skipped when a connector named `devtools` is already registered (an app
 * that wires it by hand keeps control). A missing package is the normal case
 * and stays silent; any other load failure is reported and ignored, because
 * a dev tool must never stop the app from booting.
 */
export async function registerInstalledDevtools(
  load: () => Promise<DevtoolsModule> = () => import(DEVTOOLS_PACKAGE),
): Promise<boolean> {
  if (connectorsManager.has("devtools")) {
    return false;
  }

  let devtools: DevtoolsModule;

  try {
    devtools = await load();
  } catch (error) {
    if (!isMissingPackage(error)) {
      devLogWarn(`${DEVTOOLS_PACKAGE} is installed but failed to load: ${describe(error)}`);
    }

    return false;
  }

  if (typeof devtools.devtoolsConnector !== "function") {
    devLogWarn(`${DEVTOOLS_PACKAGE} does not export devtoolsConnector(); it was not started`);

    return false;
  }

  connectorsManager.register(devtools.devtoolsConnector());

  return true;
}

/** True when the error says the devtools package itself is not installed. */
function isMissingPackage(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;

  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
    return false;
  }

  // A missing module INSIDE an installed devtools is a broken install, not an
  // absent package — only the package's own name counts as "not installed".
  return (
    describe(error).includes(`'${DEVTOOLS_PACKAGE}'`) ||
    describe(error).includes(`"${DEVTOOLS_PACKAGE}"`)
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
