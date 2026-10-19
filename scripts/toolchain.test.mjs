import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// This workspace declares explicit package paths in pnpm-workspace.yaml.
function packageManifests(workspaceRoot) {
  const workspace = readFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
  const packages = [...workspace.matchAll(/^  - (packages\/[a-z0-9-]+)$/gm)];
  assert.ok(packages.length > 0, "Expected explicit workspace package paths");
  return packages
    .map(([, directory]) => path.join(workspaceRoot, directory, "package.json"))
    .filter((manifest) => existsSync(manifest));
}

test("package discovery ignores scratch directories and files", (t) => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "warlock-toolchain-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  writeFileSync(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    ["packages:", "  - packages/widget", "  - packages/missing-manifest", ""].join("\n"),
  );
  for (const name of ["widget", ".skill-snippet-gate-tmp", "scratch", "missing-manifest"]) {
    mkdirSync(path.join(workspaceRoot, "packages", name), { recursive: true });
  }
  for (const name of ["widget", ".skill-snippet-gate-tmp", "scratch"]) {
    writeFileSync(path.join(workspaceRoot, "packages", name, "package.json"), "{}");
  }
  writeFileSync(path.join(workspaceRoot, "packages/README.md"), "workspace notes");

  assert.deepEqual(packageManifests(workspaceRoot), [
    path.join(workspaceRoot, "packages/widget/package.json"),
  ]);
});

test("workspace package defaults do not invoke deprecated lint/format tooling", () => {
  const manifests = [path.join(root, "package.json"), ...packageManifests(root)];
  for (const file of manifests) {
    const {
      scripts = {},
      dependencies = {},
      devDependencies = {},
      peerDependencies = {},
    } = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(
      Object.keys({ ...dependencies, ...devDependencies, ...peerDependencies }).filter((name) =>
        /eslint|prettier/.test(name),
      ),
      [],
      file,
    );
    for (const [name, command] of Object.entries(scripts)) {
      if (!/^(lint|fix|format)(:|$)/.test(name)) continue;
      assert.doesNotMatch(name, /eslint|prettier/, `${file} scripts.${name}`);
      assert.doesNotMatch(command, /\b(?:eslint|prettier)\b/, `${file} scripts.${name}`);
    }
  }
});

test("CI selects Oxlint/Oxfmt and never invokes Prettier compatibility scripts", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /pnpm run format:check/);
  assert.match(workflow, /pnpm run lint:oxlint/);
  assert.doesNotMatch(workflow, /run:.*(?:format:prettier|\beslint\b|\bprettier\b)/);
});
