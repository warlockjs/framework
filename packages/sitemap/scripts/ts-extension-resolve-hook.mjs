// A minimal Node loader hook (node:module customization API) that appends
// `.ts` to an extensionless relative specifier when the default resolver
// can't find it — this package's `src/` uses bundler-style extensionless
// imports (`moduleResolution: "Bundler"` in tsconfig.json), which plain
// node's ESM resolver does not do on its own.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) {
      return nextResolve(`${specifier}.ts`, context);
    }

    throw error;
  }
}
