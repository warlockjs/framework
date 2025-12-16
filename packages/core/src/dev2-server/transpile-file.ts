import { transform } from "esbuild";
import type { FileManager } from "./file-manager";
import { tsconfigManager } from "./tsconfig-manager";

/**
 * Using esbuild to transpile the given code
 */
export async function transpile(fileManager: FileManager) {
  const { code: transpiled } = await transform(fileManager.source, {
    loader: fileManager.absolutePath.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    sourcemap: "inline",
    target: "es2022",
    sourcefile: fileManager.absolutePath,
    tsconfigRaw: tsconfigManager.tsconfig,
  });

  return transpiled;
}
