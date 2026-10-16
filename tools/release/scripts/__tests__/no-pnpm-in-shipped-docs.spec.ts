import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALLOWLIST, findViolationsInText } from "../no-pnpm-in-shipped-docs.ts";

describe("findViolationsInText", () => {
  it("flags a bare pnpm invocation", () => {
    const violations = findViolationsInText("core/skills/example/SKILL.md", "pnpm add x\n");
    assert.equal(violations.length, 1);
    assert.equal(violations[0].manager, "pnpm");
    assert.equal(violations[0].line, 1);
    assert.equal(violations[0].text, "pnpm add x");
  });

  it("flags a bare yarn invocation", () => {
    const violations = findViolationsInText("core/skills/example/SKILL.md", "yarn add x\n");
    assert.equal(violations.length, 1);
    assert.equal(violations[0].manager, "yarn");
  });

  it("does NOT flag npm install", () => {
    const violations = findViolationsInText("core/skills/example/SKILL.md", "npm install x\n");
    assert.equal(violations.length, 0);
  });

  it("does NOT flag npx warlock dev", () => {
    const violations = findViolationsInText("core/skills/example/SKILL.md", "npx warlock dev\n");
    assert.equal(violations.length, 0);
  });

  it("reports the correct 1-based line number across multiple lines", () => {
    const text = "line one\nline two\npnpm warlock dev\nline four\n";
    const violations = findViolationsInText("core/skills/example/SKILL.md", text);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 3);
  });

  it("does not flag pnpm/yarn when not followed by an invocation-shaped word", () => {
    const violations = findViolationsInText(
      "core/skills/example/SKILL.md",
      "See pnpm-workspace.yaml and yarn.lock for detection details.\n",
    );
    assert.equal(violations.length, 0);
  });

  it("does not exempt unregistered paths", () => {
    const relPath = "core/skills/allowlisted-example/SKILL.md";
    const text = "intro\npnpm needs esbuild's install script allowed\nmore text\n";
    // Line 2 is the offending line in this fixture.
    assert.equal(findViolationsInText(relPath, text).length, 1);

    // Same text at a DIFFERENT (unregistered) path must still be flagged —
    // an allowlist entry is scoped to one exact file, never a pattern.
    const violationsElsewhere = findViolationsInText("core/skills/not-allowlisted/SKILL.md", text);
    assert.equal(violationsElsewhere.length, 1);
  });

  it("keeps exact content exceptions stable when preceding lines move", () => {
    const entry = ALLOWLIST[0];
    assert.equal(findViolationsInText(entry.relPath, `intro\n\n${entry.text}\n`).length, 0);
    assert.equal(findViolationsInText("other/skills/example/SKILL.md", entry.text).length, 1);
  });

  it("does not exempt changed commands at a previously allowlisted position", () => {
    const entry = ALLOWLIST[0];
    const violations = findViolationsInText(entry.relPath, `${entry.text}\npnpm add unrelated\n`);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.equal(findViolationsInText(entry.relPath, "pnpm add replacement").length, 1);
  });
});
