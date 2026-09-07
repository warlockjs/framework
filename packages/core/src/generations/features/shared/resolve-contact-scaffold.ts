import { colors } from "@mongez/copper";

/** Whether each contact-module file `completeWebInstallation` writes already exists on disk. */
export type ContactScaffoldState = {
  controllerExists: boolean;
  routesExists: boolean;
};

/** Which contact-module files may be written, and what to tell the user. */
export type ContactScaffoldPlan = {
  writeController: boolean;
  writeRoutes: boolean;
  messages: string[];
};

const CONTROLLER_PATH = "src/app/contact/controllers/contact.controller.ts";
const ROUTES_PATH = "src/app/contact/routes.ts";

/**
 * Decide which of the two contact-module files are safe to (re)write, and
 * report loudly about the ones that are not.
 *
 * Pure by design: no filesystem access here, so a test can exercise every
 * combination directly. {@link completeWebInstallation} in `web.feature.ts`
 * is the thin I/O wrapper — it stats both files, calls this, writes back
 * whatever this says to write, and prints whatever this says to print.
 *
 * `src/web/root.tsx` is the "a human has been here" sentinel for the web
 * layer as a whole, but `src/app/contact/**` is an ordinary application
 * module the web feature happens to also scaffold — nothing stops a project
 * from having its own `contact` module (with its own controller and routes)
 * independently of ever having run `warlock add web`. Trusting root.tsx's
 * absence as license to write these two files meant `warlock add web` could
 * silently overwrite a human's existing `contact` module. Exactly like
 * {@link relocateConflictingHomeRoute} already insists for the home route:
 * "`warlock add web` runs against a project a human has been living in, and
 * silently unlinking their code is not a thing an `add` command gets to do."
 * So each file gets its own independent existence guard, and an existing
 * file is skipped — never overwritten, never a reason to abort the rest of
 * the install.
 */
export function resolveContactScaffold(state: ContactScaffoldState): ContactScaffoldPlan {
  const writeController = !state.controllerExists;
  const writeRoutes = !state.routesExists;
  const messages: string[] = [];

  if (state.controllerExists) {
    messages.push(
      `${colors.yellowBright("!")} ${colors.yellowBright(CONTROLLER_PATH)} already exists, skipping — ` +
        "the contact form's endpoint is missing this controller's logic unless it already handles " +
        `${colors.yellowBright("POST /api/contact")}, so the form will 404 until you wire it yourself.`,
    );
  }

  if (state.routesExists) {
    messages.push(
      `${colors.yellowBright("!")} ${colors.yellowBright(ROUTES_PATH)} already exists, skipping — ` +
        `the contact form's endpoint (${colors.yellowBright("POST /api/contact")}) was not registered here, ` +
        "so the form will 404 until you wire it yourself.",
    );
  }

  if (writeController && writeRoutes) {
    messages.push(`${colors.green("✓")} Created POST /api/contact starter route`);
  }

  return { writeController, writeRoutes, messages };
}
