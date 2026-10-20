import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  checkTabCodeFences,
  findCollapsedTabItemFences,
  findForeignPackageManagerCommands,
} from "./check-tab-code-fences.mjs";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

test("detects collapsed install commands while accepting block fences", () => {
  assert.deepEqual(
    findCollapsedTabItemFences(
      '<Tabs>\n  <TabItem label="npm">```bash npm install example ```</TabItem>\n</Tabs>',
    ),
    [2],
  );
  assert.deepEqual(
    findCollapsedTabItemFences(
      '<TabItem label="npm">\n\n```bash\nnpm install example\n```\n\n</TabItem>',
    ),
    [],
  );
});

test("ignores markup shown inside backtick or tilde code examples", () => {
  for (const fence of ["````", "~~~"]) {
    assert.deepEqual(
      findCollapsedTabItemFences(
        `${fence}mdx\n<TabItem>\u0060\u0060\u0060bash npm install example\n${fence}`,
      ),
      [],
    );
  }
});

test("scans MDX files and reports the actual path and line", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warlock-tab-fences-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "broken.mdx"),
    '# Install\n\n<TabItem label="npm">```bash npm install example ```</TabItem>\n',
  );
  await writeFile(join(root, "unrelated.md"), "<TabItem>```bash ignored ```</TabItem>");
  const reports = [];
  assert.deepEqual(await checkTabCodeFences(root, (line) => reports.push(line)), {
    files: 1,
    violations: 1,
  });
  assert.match(reports[0], /^broken\.mdx:3:/);
});

test("flags another package manager's command inside a package-manager tab", () => {
  const source = [
    '<Tabs syncKey="pm">',
    '  <TabItem label="npm">',
    "",
    "```bash",
    "npm install example",
    "npx warlock migrate",
    "```",
    "",
    "  </TabItem>",
    '  <TabItem label="yarn">',
    "",
    "```bash",
    "pnpm add example",
    "  pnpm warlock migrate",
    "```",
    "",
    "  </TabItem>",
    '  <TabItem label="pnpm">',
    "",
    "```bash",
    "pnpm add example",
    "```",
    "",
    "  </TabItem>",
    "</Tabs>",
    "",
    "pnpm add outside-any-tab",
  ].join("\n");
  assert.deepEqual(findForeignPackageManagerCommands(source), [
    { line: 13, label: "yarn", command: "pnpm" },
    { line: 14, label: "yarn", command: "pnpm" },
  ]);
});

test("reports foreign package-manager commands with path and line", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "warlock-tab-pm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "install.mdx"),
    '<TabItem label="yarn">\n\n```bash\npnpm add example\n```\n\n</TabItem>\n',
  );
  const reports = [];
  assert.deepEqual(await checkTabCodeFences(root, (line) => reports.push(line)), {
    files: 1,
    violations: 1,
  });
  assert.match(reports[0], /^install\.mdx:4: the "yarn" TabItem runs a pnpm command/);
});

test("wire-response and locale snippets are parseable JSON", async () => {
  for (const name of [
    "packages/core/skills/validate-input/SKILL.md",
    "docs/src/content/docs/v/latest/seal/recipes/custom-error-messages.md",
  ]) {
    const source = await readFile(join(workspaceRoot, name), "utf8");
    const blocks = [...source.matchAll(/```json\n([\s\S]*?)```/g)];
    assert.ok(blocks.length > 0, `Missing JSON example in ${name}`);
    for (const block of blocks) assert.doesNotThrow(() => JSON.parse(block[1]), name);
  }
});

test("provider options remain prose and repaired documents have no empty trailing code blocks", async () => {
  const xai = await readFile(join(workspaceRoot, "packages/ai-xai/skills/SKILL.md"), "utf8");
  const prose = xai.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "");
  assert.match(prose, /^## Provider body options and token estimates$/m);
  assert.match(prose, /Models from this adapter have no native/);
  for (const name of [
    "packages/access/skills/configure-access/SKILL.md",
    "packages/access/skills/implement-resolver/SKILL.md",
    "packages/access/skills/manage-roles/SKILL.md",
    "packages/ai-workspace/README.md",
  ]) {
    const source = await readFile(join(workspaceRoot, name), "utf8");
    assert.doesNotMatch(source, /\n```\s*\n```\s*$/);
    assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, name);
  }
});
