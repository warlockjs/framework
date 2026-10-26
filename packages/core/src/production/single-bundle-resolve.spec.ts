import esbuild from "esbuild";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearNativePackageCache, stageNativePackages } from "./native-addons";
import {
  appDeclares,
  createSingleBundleReport,
  isBuildTimeTool,
  pruneUnreachableNative,
  singleBundleResolve,
} from "./single-bundle-resolve";

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

async function bundle(entry: string, appRoot: string = root) {
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
      entryPoints: [path.join(appRoot, entry)],
      outfile: path.join(appRoot, "out.js"),
      packages: "bundle",
      plugins: [singleBundleResolve({ appRoot, aliasKeys: [], report })],
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

/** A second app with its own manifest, for tests that depend on where a package is listed. */
function appWith(manifest: object, aliasedNative = false): string {
  const app = mkdtempSync(path.join(tmpdir(), "warlock-single-bundle-app-"));
  const put = (relative: string, content: string) => {
    mkdirSync(path.dirname(path.join(app, relative)), { recursive: true });
    writeFileSync(path.join(app, relative), content);
  };
  const installed = (name: string, extra: object, files: Record<string, string>) => {
    put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0", ...extra }));
    for (const [file, content] of Object.entries(files))
      put(`node_modules/${name}/${file}`, content);
  };

  put("package.json", JSON.stringify({ name: "app", ...manifest }));
  installed(
    "host",
    {
      main: "index.js",
      peerDependencies: { vite: "*" },
      optionalDependencies: { "node-pty": "*" },
    },
    {
      "index.js":
        'export const dev = () => import("vite"); export const pty = () => import("node-pty");\n',
    },
  );
  installed(
    "vite",
    { main: "index.js", dependencies: { rolldown: "1.0.0" } },
    { "index.js": "import 'rolldown'; export const REAL_VITE = 1;\n" },
  );
  installed(
    "rolldown",
    { main: "index.js" },
    { "index.js": "export default 1;\n", "r.node": "bin" },
  );

  if (aliasedNative) {
    // npm installs `"node-pty": "npm:@lydell/node-pty"` as node_modules/node-pty.
    installed(
      "node-pty",
      { main: "index.js" },
      { "index.js": "module.exports = {};\n", "pty.node": "bin" },
    );
    put(
      "node_modules/node-pty/package.json",
      JSON.stringify({ name: "@lydell/node-pty", version: "1.0.0", main: "index.js" }),
    );
  }

  put("src/main.js", 'import { dev, pty } from "host"; dev(); pty();\n');

  return app;
}

describe("build-time tools", () => {
  it("does not bundle vite listed in devDependencies, and stages no native addon for it", async () => {
    const app = appWith({ dependencies: { host: "1.0.0" }, devDependencies: { vite: "1.0.0" } });
    const { report, text, error } = await bundle("src/main.js", app);

    expect(error).toBeUndefined();
    expect(text).toMatch(/import\("vite"\)/);
    expect(text).not.toContain("REAL_VITE");
    expect(report.native.has("rolldown")).toBe(false);
    rmSync(app, { recursive: true, force: true });
  });

  it("does not bundle vite listed in dependencies either", async () => {
    const app = appWith({ dependencies: { host: "1.0.0", vite: "1.0.0" } });
    const { report, text, error } = await bundle("src/main.js", app);

    expect(error).toBeUndefined();
    expect(text).toMatch(/import\("vite"\)/);
    expect(text).not.toContain("REAL_VITE");
    expect(report.native.has("rolldown")).toBe(false);
    expect([...report.buildTimeOnly]).toContain("vite");
    rmSync(app, { recursive: true, force: true });
  });

  it("knows the tools by name and by scope", () => {
    for (const name of [
      "vite",
      "rolldown",
      "lightningcss",
      "lightningcss-linux-x64-gnu",
      "@vitejs/plugin-react",
      "esbuild",
      "@esbuild/linux-x64",
      "oxc-parser",
      "@babel/core",
    ]) {
      expect(isBuildTimeTool(name), name).toBe(true);
    }

    for (const name of ["@babel/runtime", "react", "viteish", "fastify"]) {
      expect(isBuildTimeTool(name), name).toBe(false);
    }
  });

  it("counts only dependencies, optionalDependencies and peerDependencies as declared", () => {
    const manifest = {
      dependencies: { a: "1" },
      optionalDependencies: { b: "1" },
      peerDependencies: { c: "1" },
      devDependencies: { d: "1" },
    } as Parameters<typeof appDeclares>[0];

    expect(["a", "b", "c", "d"].map((name) => appDeclares(manifest, name))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("aliased native packages", () => {
  it("records a native package under the imported name, not the real package name", async () => {
    const app = appWith(
      { dependencies: { host: "1.0.0", "node-pty": "npm:@lydell/node-pty" } },
      true,
    );
    const { report, error } = await bundle("src/main.js", app);

    expect(error).toBeUndefined();
    expect([...report.native.keys()]).toEqual(["node-pty"]);

    const dist = path.join(app, "dist");
    const result = await stageNativePackages(dist, [...report.native.values()]);

    expect(result.staged).toEqual(["node-pty"]);
    expect(existsSync(path.join(dist, "node_modules", "node-pty", "pty.node"))).toBe(true);
    expect(existsSync(path.join(dist, "node_modules", "@lydell"))).toBe(false);
    rmSync(app, { recursive: true, force: true });
  });
});

describe("pruneUnreachableNative", () => {
  it("keeps only native packages the bundle still imports", () => {
    const report = createSingleBundleReport();

    report.native.set("kept", { name: "kept", directory: "/x/kept" });
    report.native.set("gone", { name: "gone", directory: "/x/gone" });

    const removed = pruneUnreachableNative(report, {
      "app.js": {
        imports: [
          { path: "kept/lib/a.js", external: true },
          { path: "gone", external: false },
        ],
      },
    });

    expect(removed).toEqual(["gone"]);
    expect([...report.native.keys()]).toEqual(["kept"]);
  });
});
