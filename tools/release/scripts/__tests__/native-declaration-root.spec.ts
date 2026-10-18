import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { build } from "tsdown";
import { patchNativeDeclarationRoot } from "../patch-native-declaration-root.mjs";

describe("native declaration root compatibility", () => {
  it("patches once, is idempotent and refuses an unfamiliar implementation", () => {
    const original = "rootDir: tsconfig ? path.dirname(tsconfig) : cwd,";
    const patched = patchNativeDeclarationRoot(original);
    assert.match(patched, /tsconfigRaw.compilerOptions\?\.rootDir/);
    assert.equal(patchNativeDeclarationRoot(patched), patched);
    assert.throws(() => patchNativeDeclarationRoot("changed upstream"), /Unsupported/);
    assert.throws(() => patchNativeDeclarationRoot(original + original), /Unsupported/);
  });

  it("emits declarations for a sibling source import entirely inside the build output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "warlock-native-dts-"));
    const consumer = path.join(root, "consumer");
    const sibling = path.join(root, "sibling");
    try {
      await mkdir(path.join(consumer, "src"), { recursive: true });
      await mkdir(path.join(sibling, "src"), { recursive: true });
      await writeFile(path.join(sibling, "src/index.ts"), 'export const value = "valid";');
      await writeFile(
        path.join(consumer, "src/index.ts"),
        'export { value } from "../../sibling/src/index";',
      );
      await writeFile(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            rootDir: "..",
            declaration: true,
            declarationMap: true,
            module: "ESNext",
            moduleResolution: "bundler",
            types: [],
            lib: ["ES2022"],
            skipLibCheck: true,
          },
          include: ["src"],
        }),
      );
      await build({
        config: false,
        entry: [path.join(consumer, "src/index.ts")],
        tsconfig: path.join(consumer, "tsconfig.json"),
        outDir: path.join(root, "built"),
        format: ["esm"],
        dts: true,
        logLevel: "silent",
      });
      assert.match(await readFile(path.join(root, "built/index.d.mts"), "utf8"), /valid/);
      assert.deepEqual(await readdir(path.join(consumer, "src")), ["index.ts"]);
      assert.deepEqual(await readdir(path.join(sibling, "src")), ["index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
