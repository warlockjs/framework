import esbuild from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectWildcardPathAliases,
  substituteWildcard,
  tsconfigPathAliases,
} from "./tsconfig-path-aliases";

let root: string;

function write(relative: string, content: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

async function bundle(options: { withPlugin: boolean; entry?: string }) {
  return esbuild.build({
    platform: "node",
    format: "esm",
    bundle: true,
    write: false,
    logLevel: "silent",
    entryPoints: [path.join(root, options.entry ?? "src/entry.ts")],
    outfile: path.join(root, "out.js"),
    // The production build's setting, and the one that turns an unresolved
    // alias into a bare specifier instead of a build error.
    packages: "external",
    plugins: options.withPlugin
      ? [
          tsconfigPathAliases({
            baseUrl: path.join(root, "src"),
            paths: { "app/*": ["app/*"], "web/*": ["web/*"], "@app/exact": ["app/model.ts"] },
          }),
        ]
      : [],
  });
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-tsconfig-paths-"));

  write("src/entry.ts", [`import { user } from "app/model";`, `console.log(user);`].join("\n"));
  write("src/app/model.ts", `export const user = "APP_MODEL_MARKER";`);
  write("src/web/widget/index.ts", `export const widget = "WEB_WIDGET_INDEX_MARKER";`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collectWildcardPathAliases", () => {
  it("keeps only the wildcard entries and resolves their targets against baseUrl", () => {
    const aliases = collectWildcardPathAliases(
      { "app/*": ["app/*"], "@warlock.js/core": ["../../core/src/index.ts"] },
      "/base",
    );

    expect(aliases).toHaveLength(1);
    expect(aliases[0]!.prefix).toBe("app/");
    expect(aliases[0]!.targets[0]).toBe(path.resolve("/base", "app/*"));
  });

  it("tries the most specific prefix first", () => {
    const aliases = collectWildcardPathAliases(
      { "app/*": ["a/*"], "app/users/*": ["b/*"] },
      "/base",
    );

    expect(aliases.map((alias) => alias.prefix)).toEqual(["app/users/", "app/"]);
  });
});

describe("substituteWildcard", () => {
  const alias = { prefix: "app/", suffix: "", targets: ["/base/app/*"] } as const;

  it("splices what the star matched into each target", () => {
    expect(substituteWildcard(alias, "app/users/model")).toEqual(["/base/app/users/model"]);
  });

  it("declines a specifier the prefix does not cover", () => {
    expect(substituteWildcard(alias, "appended/thing")).toBeUndefined();
  });

  it("declines the bare prefix, which matches nothing", () => {
    expect(substituteWildcard(alias, "app/")).toBeUndefined();
  });
});

describe("tsconfigPathAliases", () => {
  it("resolves a wildcard alias to the file it names", async () => {
    const output = (await bundle({ withPlugin: true })).outputFiles[0]!.text;

    expect(output).toContain("APP_MODEL_MARKER");
    expect(output).not.toContain(`"app/model"`);
  });

  it("RED CONTROL — without it the specifier survives into the artifact for Node to fail on", async () => {
    // This is the exact shape of the real failure: the build SUCCEEDS and
    // `warlock start` dies with `Cannot find package 'app'`.
    const result = await bundle({ withPlugin: false });
    const output = result.outputFiles[0]!.text;

    expect(result.errors).toHaveLength(0);
    expect(output).not.toContain("APP_MODEL_MARKER");
    expect(output).toContain(`"app/model"`);
  });

  it("leaves extension and index resolution to esbuild rather than reimplementing it", async () => {
    // `web/widget` is a DIRECTORY with an `index.ts`. The plugin only
    // substitutes the star; everything after that is esbuild's own resolver.
    write(
      "src/entry2.ts",
      [`import { widget } from "web/widget";`, `console.log(widget);`].join("\n"),
    );

    const output = (await bundle({ withPlugin: true, entry: "src/entry2.ts" })).outputFiles[0]!
      .text;

    expect(output).toContain("WEB_WIDGET_INDEX_MARKER");
  });

  it("reports a matched-but-unresolvable alias as a build error instead of externalising it", async () => {
    write("src/entry3.ts", `import "app/does-not-exist";`);

    const result = await esbuild
      .build({
        platform: "node",
        format: "esm",
        bundle: true,
        write: false,
        logLevel: "silent",
        entryPoints: [path.join(root, "src/entry3.ts")],
        outfile: path.join(root, "out3.js"),
        packages: "external",
        plugins: [
          tsconfigPathAliases({ baseUrl: path.join(root, "src"), paths: { "app/*": ["app/*"] } }),
        ],
      })
      .catch((error: { errors?: unknown[] }) => error);

    expect((result as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  });

  it("leaves a specifier no alias prefix covers alone", async () => {
    write("src/entry4.ts", `import "some-real-package";`);

    const output = (await bundle({ withPlugin: true, entry: "src/entry4.ts" })).outputFiles[0]!
      .text;

    expect(output).toContain(`"some-real-package"`);
  });
});
