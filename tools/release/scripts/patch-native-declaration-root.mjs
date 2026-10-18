import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const original = "rootDir: tsconfig ? path.dirname(tsconfig) : cwd,";
const corrected =
  'rootDir: path.resolve(tsconfig ? path.dirname(tsconfig) : cwd, tsconfigRaw.compilerOptions?.rootDir ?? "."),';

/** Keep native declaration emit and its output lookup on the same configured root. */
export function patchNativeDeclarationRoot(source) {
  if (source.includes(corrected) && !source.includes(original)) return source;
  if (source.split(original).length !== 2) {
    throw new Error(
      "Unsupported rolldown-plugin-dts native root implementation; review the compatibility patch before building releases.",
    );
  }
  return source.replace(original, corrected);
}

export function installNativeDeclarationRootPatch() {
  const pkgistRequire = createRequire(import.meta.resolve("@mongez/pkgist"));
  const tsdownRequire = createRequire(pkgistRequire.resolve("tsdown"));
  const entry = tsdownRequire.resolve("rolldown-plugin-dts");
  const source = readFileSync(entry, "utf8");
  const patched = patchNativeDeclarationRoot(source);
  if (patched !== source) writeFileSync(entry, patched);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installNativeDeclarationRootPatch();
}
