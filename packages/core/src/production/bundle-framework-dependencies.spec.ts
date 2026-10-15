import esbuild from "esbuild";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleFrameworkDependencies } from "./bundle-framework-dependencies";

/**
 * Every assertion here reads the OUTPUT of a real `esbuild.build()`. Nothing
 * inspects the plugin's return values directly: what this plugin is for is
 * what survives into the artifact, and "the callback returned external: true"
 * is not that — esbuild's `alias` option beat exactly such a callback during
 * development, which no test of the callback could have caught.
 */
let root: string;

function write(relative: string, content: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

async function bundle(options: { withPlugin: boolean; alias?: Record<string, string> }) {
  const result = await esbuild.build({
    platform: "node",
    format: "esm",
    bundle: true,
    write: false,
    logLevel: "silent",
    entryPoints: [path.join(root, "app/src/entry.js")],
    outfile: path.join(root, "out.js"),
    packages: options.withPlugin ? "bundle" : "external",
    alias: options.alias,
    plugins: options.withPlugin
      ? [
          bundleFrameworkDependencies({
            appRoot: path.join(root, "app"),
            aliasKeys: Object.keys(options.alias ?? {}),
          }),
        ]
      : [],
  });

  return result.outputFiles[0]!.text;
}

/**
 * The set of specifiers the artifact still asks someone else to resolve.
 * Matches only what an emitted ESM bundle can carry: `from "x"` and a bare
 * `import "x"`.
 */
function externalsOf(output: string): string[] {
  return [...output.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-bundle-framework-"));

  // The app. `app-dep` is its own declared dependency and must stay a bare
  // specifier; the app is what resolves it at runtime, from its own tree.
  write("app/package.json", JSON.stringify({ name: "the-app", dependencies: { "app-dep": "1" } }));
  write(
    "app/src/entry.js",
    [
      `import "app-dep";`,
      `import { framework } from "../../framework/index.js";`,
      `console.log(framework);`,
    ].join("\n"),
  );

  // The framework, OUTSIDE the app root — reached the way a tsconfig alias
  // reaches it, by absolute path into a source folder the app never installed.
  write(
    "framework/package.json",
    JSON.stringify({
      name: "the-framework",
      dependencies: { "framework-dep": "1" },
      peerDependencies: { "optional-peer": "1" },
      peerDependenciesMeta: { "optional-peer": { optional: true } },
    }),
  );
  write(
    "framework/index.js",
    [
      `import { dep } from "framework-dep";`,
      `export const framework = async () => [dep, await import("optional-peer")];`,
    ].join("\n"),
  );

  // `framework-dep` lives where only the framework can see it — a node_modules
  // beside the framework, not beside the app. This is the pnpm shape the whole
  // defect is about: leave the specifier bare and the app cannot resolve it.
  write(
    "framework/node_modules/framework-dep/package.json",
    JSON.stringify({
      name: "framework-dep",
      main: "index.js",
      dependencies: { "nested-dep": "1" },
    }),
  );
  write(
    "framework/node_modules/framework-dep/index.js",
    [
      `import { nested } from "nested-dep";`,
      `export const dep = "FRAMEWORK_DEP_MARKER" + nested;`,
    ].join("\n"),
  );

  // One level deeper, and reachable ONLY from `framework-dep` — the transitive
  // case. Its manifest sits behind a TYPE-MARKER manifest (`{"type":"module"}`
  // with no name), which is what `glob/dist/commonjs/package.json` is and what
  // made a real build leave `require("path-scurry")` external.
  write(
    "framework/node_modules/framework-dep/node_modules/nested-dep/package.json",
    JSON.stringify({ name: "nested-dep", main: "lib/index.js", dependencies: { "leaf-dep": "1" } }),
  );
  write(
    "framework/node_modules/framework-dep/node_modules/nested-dep/lib/package.json",
    JSON.stringify({ type: "module" }),
  );
  write(
    "framework/node_modules/framework-dep/node_modules/nested-dep/lib/index.js",
    [`import { leaf } from "leaf-dep";`, `export const nested = "NESTED_DEP_MARKER" + leaf;`].join(
      "\n",
    ),
  );
  write(
    "framework/node_modules/leaf-dep/package.json",
    JSON.stringify({ name: "leaf-dep", main: "index.js" }),
  );
  write("framework/node_modules/leaf-dep/index.js", `export const leaf = "LEAF_DEP_MARKER";`);

  // Resolvable, but declared by NOBODY — the framework imports it without
  // listing it. Sits beside the framework so esbuild could resolve it if
  // asked, which is what makes this a real test rather than a missing file.
  write(
    "framework/node_modules/undeclared-lib/package.json",
    JSON.stringify({ name: "undeclared-lib", main: "index.js" }),
  );
  write("framework/node_modules/undeclared-lib/index.js", `export const x = "UNDECLARED_MARKER";`);

  write(
    "framework/node_modules/optional-peer/package.json",
    JSON.stringify({ name: "optional-peer", main: "index.js" }),
  );
  write(
    "framework/node_modules/optional-peer/index.js",
    `export const peer = "OPTIONAL_PEER_MARKER";`,
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bundleFrameworkDependencies", () => {
  it("bundles a framework's own declared dependency the app never installed", async () => {
    const output = await bundle({ withPlugin: true });

    expect(output).toContain("FRAMEWORK_DEP_MARKER");
    expect(externalsOf(output)).not.toContain("framework-dep");
  });

  it("RED CONTROL — the same build without the plugin leaves it for the app to resolve", async () => {
    const output = await bundle({ withPlugin: false });

    expect(output).not.toContain("FRAMEWORK_DEP_MARKER");
    expect(externalsOf(output)).toContain("framework-dep");
  });

  it("follows the dependency outward, through a package's own nested copies", async () => {
    const output = await bundle({ withPlugin: true });

    expect(output).toContain("NESTED_DEP_MARKER");
    expect(output).toContain("LEAF_DEP_MARKER");
  });

  it("walks past a type-marker manifest to the package that really owns the file", async () => {
    // `nested-dep/lib/package.json` is `{"type":"module"}` — no name, no
    // dependencies. Stopping there makes `leaf-dep` look undeclared and it is
    // left external; the marker below is only present if the walk continued.
    const output = await bundle({ withPlugin: true });

    expect(output).toContain("LEAF_DEP_MARKER");
    expect(externalsOf(output)).not.toContain("leaf-dep");
  });

  it("leaves the APP's own declared dependency external", async () => {
    expect(externalsOf(await bundle({ withPlugin: true }))).toContain("app-dep");
  });

  it("leaves an optional peer external even though it is installed and resolvable", async () => {
    // Canon 5f684f28. `optional-peer` is a peerDependency, never a
    // dependency, and it is reached through `await import(...)`. It is
    // present in this fixture precisely so that "it wasn't there" cannot be
    // the reason it stayed external.
    const output = await bundle({ withPlugin: true });

    expect(output).not.toContain("OPTIONAL_PEER_MARKER");
    expect(externalsOf(output)).toContain("optional-peer");
  });

  it("leaves a resolvable package no manifest declares external", async () => {
    write(
      "framework/index.js",
      [`import "undeclared-lib";`, `export const framework = 1;`].join("\n"),
    );

    const output = await bundle({ withPlugin: true });

    expect(output).not.toContain("UNDECLARED_MARKER");
    expect(externalsOf(output)).toContain("undeclared-lib");
  });

  it("does not pre-empt esbuild's own `alias` — the trap that emptied a whole bundle", async () => {
    // An `onResolve` callback runs BEFORE the built-in resolver, and `alias`
    // lives in the built-in resolver. Answering `external: true` here for an
    // aliased name silently unbundles everything it pointed at.
    write(
      "app/src/entry.js",
      [
        `import "app-dep";`,
        `import { framework } from "the-framework";`,
        `console.log(framework);`,
      ].join("\n"),
    );
    write("framework/index.js", `export const framework = "ALIASED_FRAMEWORK_MARKER";`);

    const alias = { "the-framework": path.join(root, "framework/index.js") };
    const output = await bundle({ withPlugin: true, alias });

    expect(output).toContain("ALIASED_FRAMEWORK_MARKER");
    expect(externalsOf(output)).not.toContain("the-framework");
  });
});
