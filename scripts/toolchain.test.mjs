import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("workspace package defaults do not invoke deprecated lint/format tooling", () => {
  const manifests = [
    "package.json",
    ...readdirSync(path.join(root, "packages")).map((name) => `packages/${name}/package.json`),
  ];
  for (const file of manifests) {
    const { scripts = {} } = JSON.parse(read(file));
    for (const [name, command] of Object.entries(scripts)) {
      if (!/^(lint|fix|format)(:|$)/.test(name)) continue;
      if (name.startsWith("format:prettier")) {
        assert.match(command, /Deprecated:.*5\.34\.0/);
        continue;
      }
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
