import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { runDevtoolsUiGate } from "../devtools-ui-gate.ts";
// Plain ESM helpers from the package's ui-src/scripts (no types beyond the .d.mts siblings).
import { dashboardSourceHash } from "../../../../packages/devtools/ui-src/scripts/source-hash.mjs";
import { writeBuildInfo } from "../../../../packages/devtools/ui-src/scripts/write-build-info.mjs";

/**
 * Specs for the shipped devtools dashboard gate. Each test builds a fake
 * repository (`packages/devtools` with ui-src, contracts, package.json and a
 * `ui/dashboard` bundle with a real build-info.json). The fresh build is
 * injected: it copies a snapshot folder instead of running Vite.
 */

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const SOURCES: Record<string, string> = {
  "ui-src/index.html": "<!doctype html><title>dashboard</title>\n",
  "ui-src/src/main.tsx": "export const boot = () => 'ok';\n",
  "ui-src/tests/setup.ts": "// test setup\n",
  "ui-src/scripts/helper.mjs": "// build helper\n",
  "ui-src/README.md": "# readme\n",
  "src/production/contracts.ts": "export type Shape = { id: string };\n",
  "package.json": JSON.stringify(
    {
      name: "@warlock.js/devtools",
      devDependencies: { react: "19.2.8", vite: "8.3.3", zod: "4.0.0" },
    },
    null,
    2,
  ),
};

const SHIPPED: Record<string, string> = {
  "index.html": '<!doctype html><script type="module" src="./assets/app.js"></script>\n',
  "assets/app.js": "console.log('dashboard');\n".repeat(50),
  "assets/app.css": "body{margin:0}\n",
};

type Fixture = {
  repoRoot: string;
  packageDir: string;
  shippedDir: string;
  /** The bundle a fresh build produces; tests change it to simulate a build that differs. */
  freshDir: string;
};

async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function createFixture(): Promise<Fixture> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "devtools-ui-gate-spec-"));
  dirs.push(repoRoot);
  const packageDir = path.join(repoRoot, "packages", "devtools");
  const shippedDir = path.join(packageDir, "ui", "dashboard");
  const freshDir = path.join(repoRoot, "fresh-build");
  await writeTree(packageDir, SOURCES);
  await writeTree(shippedDir, SHIPPED);
  await writeBuildInfo({ packageDir, outDir: shippedDir });
  await writeTree(freshDir, SHIPPED);
  return { repoRoot, packageDir, shippedDir, freshDir };
}

/** A `build` option that copies the fixture's fresh bundle instead of running Vite. */
function copyingBuild(fixture: Fixture) {
  return async (outDir: string) => {
    await cp(fixture.freshDir, outDir, { recursive: true });
  };
}

function gate(fixture: Fixture, build = copyingBuild(fixture)) {
  return runDevtoolsUiGate({ repoRoot: fixture.repoRoot, build });
}

const STALE = /is stale/;

describe("runDevtoolsUiGate", () => {
  it("passes when the bundle is fresh, unmodified and within budget", async () => {
    const fixture = await createFixture();
    const result = await gate(fixture);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.sizes.budgetGzipBytes, 307200);
    assert.ok(result.sizes.files["assets/app.js"]!.gzipBytes > 0);
    assert.ok(result.sizes.gzipBytes > 0);
  });

  it("reports a stale bundle when a source changed after the build", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.packageDir, "ui-src/src/main.tsx"),
      "export const boot = () => 'changed';\n",
    );
    const result = await gate(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]!, STALE);
    assert.match(result.problems[0]!, /pnpm --filter @warlock\.js\/devtools build:ui/);
  });

  it("reports a hand-edited bundle file", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.shippedDir, "assets/app.js"), "console.log('hand edit');\n");
    const result = await gate(fixture);
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) => /assets\/app\.js does not match its hash/.test(problem)),
    );
  });

  it("reports a stale bundle when a fresh build differs from the shipped files", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.freshDir, "assets/app.css"), "body{margin:1px}\n");
    const result = await gate(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]!, /does not match a fresh build/);
    assert.match(result.problems[0]!, /assets\/app\.css/);
  });

  it("reports a bundle over the gzip budget", async () => {
    const fixture = await createFixture();
    // Random bytes do not compress, so the gzipped size is about the raw size.
    const big = randomBytes(400_000);
    await writeTree(fixture.shippedDir, { "assets/app.js": big });
    await writeTree(fixture.freshDir, { "assets/app.js": big });
    await writeBuildInfo({ packageDir: fixture.packageDir, outDir: fixture.shippedDir });
    const result = await gate(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]!, /over the 300 KB budget/);
    assert.match(result.problems[0]!, /assets\/app\.js/);
    assert.ok(result.sizes.gzipBytes > 307200);
  });

  it("reports a stale bundle when build-info.json is missing", async () => {
    const fixture = await createFixture();
    await unlink(path.join(fixture.shippedDir, "build-info.json"));
    const result = await gate(fixture);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => STALE.test(problem)));
  });

  it("reports a failed fresh build instead of throwing", async () => {
    const fixture = await createFixture();
    const result = await gate(fixture, async () => {
      throw new Error("vite exploded");
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) => /fresh build .* failed: vite exploded/.test(problem)),
    );
  });
});

describe("dashboardSourceHash", () => {
  it("gives the same hash for CRLF and LF line endings", async () => {
    const fixture = await createFixture();
    const file = path.join(fixture.packageDir, "ui-src/src/main.tsx");
    await writeFile(file, "export const a = 1;\nexport const b = 2;\n");
    const lf = await dashboardSourceHash(fixture.packageDir);
    await writeFile(file, "export const a = 1;\r\nexport const b = 2;\r\n");
    const crlf = await dashboardSourceHash(fixture.packageDir);
    assert.equal(crlf, lf);
  });

  it("ignores ui-src tests, scripts and README", async () => {
    const fixture = await createFixture();
    const before = await dashboardSourceHash(fixture.packageDir);
    await writeFile(path.join(fixture.packageDir, "ui-src/tests/setup.ts"), "// changed\n");
    await writeFile(path.join(fixture.packageDir, "ui-src/scripts/helper.mjs"), "// changed\n");
    await writeFile(path.join(fixture.packageDir, "ui-src/README.md"), "# changed\n");
    assert.equal(await dashboardSourceHash(fixture.packageDir), before);
  });

  it("ignores tool caches under ui-src/node_modules", async () => {
    const fixture = await createFixture();
    const before = await dashboardSourceHash(fixture.packageDir);
    await writeTree(fixture.packageDir, {
      "ui-src/node_modules/.vite/vitest/results.json": '{"results":{}}\n',
    });
    assert.equal(await dashboardSourceHash(fixture.packageDir), before);
  });

  it("changes when a covered source, the contracts or a pinned dependency changes", async () => {
    const fixture = await createFixture();
    const before = await dashboardSourceHash(fixture.packageDir);
    await writeFile(
      path.join(fixture.packageDir, "src/production/contracts.ts"),
      "export type Shape = {};\n",
    );
    const afterContracts = await dashboardSourceHash(fixture.packageDir);
    assert.notEqual(afterContracts, before);

    const manifestPath = path.join(fixture.packageDir, "package.json");
    const manifest = JSON.parse(SOURCES["package.json"]!) as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies["react"] = "19.2.9";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    assert.notEqual(await dashboardSourceHash(fixture.packageDir), afterContracts);
  });

  it("ignores a dev dependency the dashboard does not build with", async () => {
    const fixture = await createFixture();
    const before = await dashboardSourceHash(fixture.packageDir);
    const manifestPath = path.join(fixture.packageDir, "package.json");
    const manifest = JSON.parse(SOURCES["package.json"]!) as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies["zod"] = "4.1.0";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    assert.equal(await dashboardSourceHash(fixture.packageDir), before);
  });
});
