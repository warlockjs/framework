import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectPackageSkills } from "./generate-skills.mjs";

test("catalogs one root or grouped front door, using agent-kit package slugs", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [dir, name, file] of [
    ["ai-openai", "@warlock.js/ai-openai", "SKILL.md"],
    ["core", "@warlock.js/core", "index.md"],
    ["create-warlock", "create-warlock", "SKILL.md"],
  ]) {
    mkdirSync(path.join(root, dir, "skills"), { recursive: true });
    writeFileSync(path.join(root, dir, "package.json"), JSON.stringify({ name }));
    writeFileSync(
      path.join(root, dir, "skills", file),
      '---\ndescription: "Package routing: say \\"hello\\""\n---\n',
    );
  }
  mkdirSync(path.join(root, "core/skills/task"));
  writeFileSync(path.join(root, "core/skills/task/SKILL.md"), "A topic, not a package listing.");
  const skills = collectPackageSkills(root);
  assert.deepEqual(
    skills.map(({ slug, source }) => [slug, source]),
    [
      ["warlock-js-ai-openai", "packages/ai-openai/skills/SKILL.md"],
      ["warlock-js-core", "packages/core/skills/index.md"],
      ["create-warlock", "packages/create-warlock/skills/SKILL.md"],
    ],
  );
  assert.equal(skills[0].description, 'Package routing: say "hello"');
  assert.equal(skills[0].characters, skills[0].description.length);
});
