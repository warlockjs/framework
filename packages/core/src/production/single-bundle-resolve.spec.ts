import esbuild from "esbuild";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearNativePackageCache } from "./native-addons";
import { createSingleBundleReport, singleBundleResolve } from "./single-bundle-resolve";

let root: string;

function write(relative: string, content: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function pkg(name: string, manifest: object, files: Record<string, string>): void {
  write(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
  );
  for (const [file, content] of Object.entries(files))
    write(`node_modules/${name}/${file}`, content);
}

async function bundle(entry: string) {
  const report = createSingleBundleReport();
  let error: unknown;
  let text = "";

  try {
    const result = await esbuild.build({
      platform: "node",
      format: "esm",
      bundle: true,
      write: false,
      logLevel: "silent",
      entryPoints: [path.join(root, entry)],
      outfile: path.join(root, "out.js"),
      packages: "bundle",
      plugins: [singleBundleResolve({ appRoot: root, aliasKeys: [], report })],
    });
    text = result.outputFiles[0]!.text;
  } catch (caught) {
    error = caught;
  }

  return { report, text, error };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-single-bundle-"));
  clearNativePackageCache();

  write(
    "package.json",
    JSON.stringify({ name: "app", dependencies: { "plain-dep": "1.0.0", "uses-native": "1.0.0" } }),
  );

  // A framework-like package: lazy import of a peer the app never installed,
  // of an optional dependency, and of a peer the app does declare.
  pkg(
    "framework",
    {
      main: "index.js",
      peerDependencies: { "s3-driver": "*", "plain-dep": "*" },
      optionalDependencies: { "extra-driver": "*" },
    },
    {
      "index.js":
        'export async function load() { return [await import("s3-driver"), await import("extra-driver"), await import("plain-dep")]; }\n',
    },
  );
  pkg("plain-dep", { main: "index.js" }, { "index.js": "export default 'plain';\n" });
  pkg(
    "uses-native",
    { main: "index.js", dependencies: { "native-core": "1.0.0" } },
    {
      "index.js": 'import n from "native-core"; export default n;\n',
    },
  );
  pkg(
    "native-core",
    { main: "index.js" },
    { "index.js": "module.exports = {};\n", "addon.node": "binary" },
  );

  // The app declares framework, so it can import it; the framework is a package, not app code.
  write(
    "package.json",
    JSON.stringify({
      name: "app",
      dependencies: {
        framework: "1.0.0",
        "plain-dep": "1.0.0",
        "uses-native": "1.0.0",
        scanner: "1.0.0",
      },
    }),
  );
  write("src/lazy.js", 'import { load } from "framework"; load();\n');
  write("src/native.js", 'import n from "uses-native"; console.log(n);\n');
  pkg(
    "oxc-parser",
    { main: "index.js" },
    {
      "index.js": "export const parseSync = () => 'REAL_PARSER'; export const visitorKeys = {};\n",
      "x.node": "bin",
    },
  );
  pkg(
    "scanner",
    { main: "index.js" },
    {
      "index.js":
        'import { parseSync } from "oxc-parser"; export const scan = () => parseSync();\n',
    },
  );
  write("src/uses-scanner.js", 'import { scan } from "scanner"; console.log(typeof scan);\n');
  write("src/missing.js", 'import "not-installed-anywhere";\n');
  write("src/missing-lazy.js", 'await import("not-installed-anywhere");\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("singleBundleResolve", () => {
  it("leaves optional integrations the app does not install as lazy runtime imports", async () => {
    const { report, text, error } = await bundle("src/lazy.js");

    expect(error).toBeUndefined();
    expect([...report.optional.keys()].sort()).toEqual(["extra-driver", "s3-driver"]);
    expect(report.optional.get("s3-driver")?.importedBy).toBe("framework");
    expect(text).toMatch(/import\("s3-driver"\)/);
    expect(text).toMatch(/import\("extra-driver"\)/);
  });

  it("bundles a peer the app declares", async () => {
    const { report, text } = await bundle("src/lazy.js");

    expect(report.optional.has("plain-dep")).toBe(false);
    expect(text).not.toMatch(/import\("plain-dep"\)/);
    expect(text).toContain("plain");
  });

  it("detects a package with a .node binary in the graph and keeps it external", async () => {
    const { report, text, error } = await bundle("src/native.js");

    expect(error).toBeUndefined();
    expect([...report.native.keys()]).toEqual(["native-core"]);
    expect(report.native.get("native-core")?.directory).toBe(
      path.join(root, "node_modules", "native-core"),
    );
    expect(text).toMatch(/from "native-core"/);
  });

  it("replaces a build-time tool imported by a dependency with a module that throws, and stages nothing", async () => {
    const { report, text, error } = await bundle("src/uses-scanner.js");

    expect(error).toBeUndefined();
    expect([...report.buildTimeOnly]).toEqual(["oxc-parser"]);
    expect(report.native.size).toBe(0);
    expect(text).not.toContain("REAL_PARSER");
    expect(text).toContain("is a build-time tool and is not part of a production bundle");
    expect(text).not.toMatch(/from "oxc-parser"/);
  });

  it("still fails for anything the app itself imports and cannot resolve", async () => {
    const statik = await bundle("src/missing.js");
    const lazy = await bundle("src/missing-lazy.js");

    expect(String(statik.error)).toContain("not-installed-anywhere");
    expect(String(lazy.error)).toContain("not-installed-anywhere");
  });
});
