import { createRequire } from "node:module";
import type { OnLoadArgs, OnResolveArgs, PluginBuild } from "esbuild";

const esmRequire = createRequire(import.meta.url);

export const nativeNodeModulesPlugin = {
  name: "native-node-modules",
  setup(build: PluginBuild) {
    build.onResolve({ filter: /\.node$/, namespace: "file" }, (args: OnResolveArgs) => {
      // The filter matches on the SPECIFIER, and a specifier can end in `.node`
      // without being an addon: `react-dom/server.node` is a package subpath
      // that resolves to `server.node.js`. Only a path that resolves to a real
      // `.node` file is an addon; anything else is handed back to esbuild.
      let resolved: string;

      try {
        resolved = esmRequire.resolve(args.path, { paths: [args.resolveDir] });
      } catch {
        return undefined;
      }

      return resolved.endsWith(".node") ? { path: resolved, namespace: "node-file" } : undefined;
    });

    build.onLoad({ filter: /.*/, namespace: "node-file" }, (args: OnLoadArgs) => ({
      contents: `
          import path from ${JSON.stringify(args.path)}
          try { module.exports = require(path) }
          catch {}
        `,
    }));

    build.onResolve({ filter: /\.node$/, namespace: "node-file" }, (args: OnResolveArgs) => ({
      path: args.path,
      namespace: "file",
    }));

    const opts = build.initialOptions;
    opts.loader = opts.loader || {};
    opts.loader[".node"] = "file";
  },
};
