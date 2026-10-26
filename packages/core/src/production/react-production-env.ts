import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "esbuild";

/** Files of the packages whose development build `process.env.NODE_ENV` selects. */
const REACT_PACKAGE_FILE = /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/].*\.(c|m)?js$/;

/**
 * Pick React's production build in a bundle that carries React.
 *
 * `react`, `react-dom` and `scheduler` choose between their development and
 * production builds by reading `process.env.NODE_ENV` when they load, and a
 * bundle holds both builds unless that read is settled at build time. Defining
 * `process.env.NODE_ENV` for the whole bundle would also freeze every other read
 * of it, including the framework's own (a `staging` start would read
 * `production`), so the replacement is made in those three packages' files only.
 */
export function reactProductionEnv(): Plugin {
  return {
    name: "warlock:react-production-env",
    setup(build) {
      build.onLoad({ filter: REACT_PACKAGE_FILE }, async (args) => {
        const source = await readFile(args.path, "utf8");

        if (!source.includes("process.env.NODE_ENV")) return undefined;

        return {
          contents: source.split("process.env.NODE_ENV").join('"production"'),
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}
