import { readDistBuildManifestAsync } from "./dist-build-manifest";

/**
 * Whether `dist` is safe for `warlock start` to boot, and — when it is
 * not — the reason to show the developer.
 */
export type DistReadiness =
  | { ready: true }
  | {
      ready: false;
      reason: string;
    };

/**
 * Decide whether `outDir` is fit for `warlock start` to boot.
 *
 * Checks the build-success marker a promoted build writes — not any
 * particular output file. Before this existed, `start` only failed on a
 * broken `dist` by accident, because it happened to need a file (the client
 * manifest) that an incomplete build never wrote. That guard said nothing
 * when the missing piece was anything else, and named no reason. This
 * refuses explicitly and says why.
 */
export async function checkDistReadyToStartAsync(outDir: string): Promise<DistReadiness> {
  const manifest = await readDistBuildManifestAsync(outDir);

  if (manifest) {
    return { ready: true };
  }

  return {
    ready: false,
    reason:
      `"${outDir}" was not produced by a successful \`warlock build\` run ` +
      "(no build-success marker found). Run `warlock build` before `warlock start`.",
  };
}
