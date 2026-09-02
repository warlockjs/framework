import { getJsonFileAsync, putJsonFileAsync } from "@warlock.js/fs";
import path from "path";

/**
 * Name of the marker file `warlock build` writes into the output directory
 * as the last step before promoting it to `dist`, and the only thing
 * `warlock start` trusts to tell a genuine build from stale or
 * hand-assembled output.
 *
 * Hidden (leading dot) so it never collides with a route, a static asset, or
 * anything an app might legitimately name `manifest.json`.
 */
export const DIST_BUILD_MANIFEST_FILE_NAME = ".warlock-build.json";

/**
 * Recorded once, at the end of a build that reached the promote step. Its
 * presence — with `status: "success"` — is the whole contract `warlock
 * start` checks. Not any particular output file, which a future build shape
 * could rename or drop.
 */
export type DistBuildManifest = {
  status: "success";
  builtAt: string;
};

/**
 * Write the build-success marker into an output directory (the temp
 * directory a build assembled, before it is promoted to `dist`).
 */
export async function writeDistBuildManifestAsync(directory: string): Promise<void> {
  const manifest: DistBuildManifest = {
    status: "success",
    builtAt: new Date().toISOString(),
  };

  await putJsonFileAsync(path.join(directory, DIST_BUILD_MANIFEST_FILE_NAME), manifest);
}

/**
 * Read the build-success marker out of `dist`.
 *
 * Returns `undefined` for every way the marker can fail to back a real
 * build: missing, unreadable, malformed JSON, or present without
 * `status: "success"`. "Never built", "build failed before promoting", and
 * "someone hand-edited dist" all collapse to the same outcome, because
 * `warlock start` treats them identically — refuse, and say why.
 */
export async function readDistBuildManifestAsync(
  directory: string,
): Promise<DistBuildManifest | undefined> {
  try {
    const manifest = await getJsonFileAsync<DistBuildManifest>(
      path.join(directory, DIST_BUILD_MANIFEST_FILE_NAME),
    );

    if (manifest?.status !== "success") {
      return undefined;
    }

    return manifest;
  } catch {
    return undefined;
  }
}
