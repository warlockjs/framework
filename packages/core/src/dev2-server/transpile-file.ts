import { putFileAsync } from "@mongez/fs";
import { transform } from "esbuild";
import type { FileManager } from "./file-manager";
import { tsconfigManager } from "./tsconfig-manager";
import { warlockCachePath } from "./utils";

/**
 * Using esbuild to transpile the given code
 * Uses external sourcemaps for better performance:
 * - Inline sourcemaps double file size and require base64 parsing on every import
 * - External sourcemaps keep files small and fast to parse
 * - Sourcemap files are written separately and only loaded when debugging
 */
export async function transpile(fileManager: FileManager) {
  const { code: transpiled, map: sourceMap } = await transform(
    fileManager.source,
    {
      loader: fileManager.absolutePath.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      sourcemap: "external", // External sourcemaps - Node.js doesn't parse them on import
      target: "es2022",
      sourcefile: fileManager.absolutePath,
      tsconfigRaw: tsconfigManager.tsconfig,      
    },
  );

  // Write sourcemap file if it exists and add sourceMappingURL comment
  if (sourceMap) {
    const sourceMapFileName = fileManager.cachePath.replace(/\.js$/, ".js.map");
    const sourceMapPath = warlockCachePath(sourceMapFileName);
    
    // Add sourceMappingURL comment to the transpiled code
    // This tells Node.js/debuggers where to find the sourcemap
    const codeWithSourceMap = transpiled + `\n//# sourceMappingURL=${sourceMapFileName}`;
    
    // Don't await - write sourcemap asynchronously to not block transpilation
    putFileAsync(sourceMapPath, sourceMap).catch(() => {
      // Silently fail - sourcemaps are optional
    });
    
    return codeWithSourceMap;
  }

  return transpiled;
}
