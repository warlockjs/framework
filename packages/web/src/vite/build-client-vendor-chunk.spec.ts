import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HYDRATION_CODE_SPLITTING, VENDOR_REACT_CHUNK_NAME } from "./build-client";

/**
 * The vendor split is wired through the bundler's own option, so it is proven
 * on a real build: a module under `node_modules/react/` lands in a chunk named
 * `vendor-react`, and the app's own code does not.
 */
describe("hydration client vendor split on the installed bundler", () => {
  let root: string;
  let files: string[];

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "warlock-vendor-chunk-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules/react"), { recursive: true });
    await writeFile(
      path.join(root, "node_modules/react/package.json"),
      JSON.stringify({ name: "react", version: "0.0.0", type: "module", main: "index.js" }),
    );
    await writeFile(
      path.join(root, "node_modules/react/index.js"),
      `export const createElement = () => "${"r".repeat(200)}";\n`,
    );
    await writeFile(
      path.join(root, "src/entry.js"),
      'import { createElement } from "react";\nconsole.log(createElement(), "app-code");\n',
    );
    const result = (await build({
      root,
      logLevel: "silent",
      configFile: false,
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: { entry: path.join(root, "src/entry.js") },
          output: { chunkFileNames: "assets/[name].js", entryFileNames: "assets/[name].js" },
        },
      },
    })) as Rollup.RollupOutput;
    const split = (await build({
      root,
      logLevel: "silent",
      configFile: false,
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: { entry: path.join(root, "src/entry.js") },
          output: {
            chunkFileNames: "assets/[name].js",
            entryFileNames: "assets/[name].js",
            codeSplitting: HYDRATION_CODE_SPLITTING,
          },
        },
      },
    })) as Rollup.RollupOutput;
    expect(result.output.map((file) => file.fileName)).toEqual(["assets/entry.js"]);
    files = split.output.map((file) => file.fileName).sort();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(`puts React into its own "${VENDOR_REACT_CHUNK_NAME}" chunk and keeps app code in the entry`, () => {
    expect(files).toEqual(["assets/entry.js", `assets/${VENDOR_REACT_CHUNK_NAME}.js`]);
  });
});
