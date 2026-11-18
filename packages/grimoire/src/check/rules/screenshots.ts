/**
 * GR2014: image lines that name a screenshot file that does not exist, or
 * that is not an image type the viewers serve.
 */
import { statSync } from "node:fs";
import path from "node:path";
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import type { WrittenScreenshot } from "../../contracts/written";
import { GRIMOIRE_PATHS } from "../../paths";

/** Image types a screenshot may have. */
export const SCREENSHOT_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/** GR2014: a screenshot of a story step, page, screen or block that is missing or not an image type. */
export function checkScreenshots(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];
  const folder = path.join(snapshot.root, GRIMOIRE_PATHS.screenshots);

  const check = (
    screenshots: readonly WrittenScreenshot[],
    subject: { feature?: string; flow?: string; app?: string },
  ): void => {
    for (const screenshot of screenshots) {
      // A path outside the folder is GR1029 (the parser); nothing to look up.
      if (screenshot.path === null) continue;

      const extension = path.posix.extname(screenshot.path).toLowerCase();
      const problem = !SCREENSHOT_EXTENSIONS.includes(extension)
        ? `is not one of ${SCREENSHOT_EXTENSIONS.join(", ")}`
        : isFile(path.join(folder, ...screenshot.path.split("/")))
          ? null
          : "does not exist";

      if (problem === null) continue;

      findings.push(
        createFinding({
          code: "GR2014",
          message: `the image ${JSON.stringify(screenshot.written)} ${problem} (grimoire/screenshots/${screenshot.path})`,
          at: screenshot.at,
          ...subject,
        }),
      );
    }
  };

  for (const feature of snapshot.written.features) {
    for (const flow of feature.flows) {
      for (const step of flow.story) {
        check(step.screenshots, { feature: feature.id, flow: flow.ref });
      }
    }
  }

  for (const app of snapshot.written.apps) {
    for (const page of [...app.pages, ...app.screens]) {
      check(page.screenshots, { app: app.id.value });

      for (const block of page.blockFiles) check(block.screenshots, { app: app.id.value });
    }
  }

  return findings;
}
