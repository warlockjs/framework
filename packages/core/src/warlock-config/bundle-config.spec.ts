import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleWarlockConfig } from "./bundle-config";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function project(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "warlock-bundle-config-"));

  directories.push(directory);

  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), content);
  }

  return directory;
}

describe("bundleWarlockConfig", () => {
  it("keeps @warlock.js packages external even when tsconfig paths map them to local source", async () => {
    const root = await project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@warlock.js/*": ["./framework/*"], "app/*": ["./src/*"] } },
      }),
      "framework/core.ts": "export const marker = 'inlined-framework-copy';",
      "src/local.ts": "export const local = 'inlined-local';",
      "warlock.config.ts":
        "import { marker } from '@warlock.js/core';\nimport { local } from 'app/local';\nexport default { marker, local };",
    });

    const output = await bundleWarlockConfig(path.join(root, "warlock.config.ts"));

    expect(output).toContain('from "@warlock.js/core"');
    expect(output).not.toContain("inlined-framework-copy");
    expect(output).toContain("inlined-local");
  });
});
