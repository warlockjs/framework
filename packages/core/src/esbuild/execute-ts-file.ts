/* eslint-disable @typescript-eslint/no-var-requires */
import { ensureDirectory, putFileAsync, unlinkAsync } from "@mongez/fs";
import esbuild from "esbuild";
import { pathToFileURL } from "url";
import { warlockPath } from "../utils";

//

export async function executeTsFile(
  filePath: string,
  format: "cjs" | "esm" = "esm",
) {
  ensureDirectory(warlockPath());

  const timestamp = Date.now();
  const tempFilePath = warlockPath(`warlock.${timestamp}.tmp.js`);

  try {
    const result = await esbuild.build({
      platform: "node",
      absWorkingDir: process.cwd(),
      entryPoints: [filePath],
      bundle: true,
      minify: false,
      write: false,
      packages: "external",
      format,
      target: ["node18"],
      sourcemap: "inline",
      // Ensure proper path resolution for imports
      resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      // Ensure proper node resolution
      mainFields: ["module", "main"],
    });

    await putFileAsync(tempFilePath, result.outputFiles[0].text);

    // Use URL-based imports for better cross-platform compatibility
    const fileUrl = pathToFileURL(tempFilePath).href;
    const output = await import(fileUrl);

    return output;
  } catch (error) {
    console.error("Error executing TypeScript file:", error);
    throw error;
  } finally {
    // Fire and forget cleanup - no need to await
    try {
      unlinkAsync(tempFilePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
