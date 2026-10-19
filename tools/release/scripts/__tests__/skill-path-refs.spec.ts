import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { findSkillPathRefs, runSkillLayoutGate, runSkillPathRefsGate } from "../skill-path-refs.ts";

describe("findSkillPathRefs", () => {
  it("flags a relative sibling link", () => {
    const refs = findSkillPathRefs(
      "core/skills/a/SKILL.md",
      "See [x](../send-response/SKILL.md).\n",
    );
    assert.deepEqual(
      refs.map((ref) => [ref.line, ref.ref]),
      [[1, "send-response/SKILL.md"]],
    );
  });

  it("flags a package-qualified path and a cross-package relative path", () => {
    const text =
      "see `@warlock.js/web/create-a-page/SKILL.md`\nand ../../../cache/skills/pick-cache-driver/SKILL.md\n";
    const refs = findSkillPathRefs("core/skills/a/SKILL.md", text);
    assert.deepEqual(
      refs.map((ref) => ref.line),
      [1, 2],
    );
  });

  it("does not flag the bare filename or a topic-name reference", () => {
    const text =
      "Each folder holds one `SKILL.md`.\nSee the `send-response` topic of the `warlock-js-core` skill.\n";
    assert.equal(findSkillPathRefs("core/skills/index.md", text).length, 0);
  });

  it("reports 1-based lines with CRLF input", () => {
    const refs = findSkillPathRefs("seal/skills/a/SKILL.md", "one\r\ntwo\r\nsee x/SKILL.md\r\n");
    assert.equal(refs[0]?.line, 3);
  });
});

/** Fixture root has the same shape as packages/, with no installed dependencies. */
function withSkills(files: Record<string, string>, inspect: (root: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "skill-index-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    inspect(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("runSkillLayoutGate", () => {
  it("rejects a filename that has no topic folder, naming package, index, line and topic", () => {
    withSkills(
      {
        "sample/skills/index.md":
          "---\ndescription: orientation\n---\n\nRead `missing-topic.md`.\n",
      },
      (root) => {
        assert.deepEqual(runSkillLayoutGate(root), [
          {
            package: "@warlock.js/sample",
            relPath: "sample/skills/index.md",
            line: 5,
            topic: "missing-topic",
            type: "unknown-topic",
            message:
              "index names a local topic without a matching <topic>/SKILL.md; qualify topics owned by another package",
          },
        ]);
      },
    );
  });

  it("rejects stale slugs in inline code, explicit topic names and unquoted area lists", () => {
    withSkills(
      {
        "sample/skills/index.md":
          "Read `missing-task`.\nRead `overview`.\n- **Utilities:** stale-topic, another-topic\n",
      },
      (root) => {
        assert.deepEqual(
          runSkillLayoutGate(root).map(({ topic, type, line }) => ({ topic, type, line })),
          [
            { topic: "missing-task", type: "unknown-topic", line: 1 },
            { topic: "overview", type: "unknown-topic", line: 2 },
            { topic: "stale-topic", type: "unknown-topic", line: 3 },
            { topic: "another-topic", type: "unknown-topic", line: 3 },
          ],
        );
      },
    );
  });

  it("rejects folders without SKILL.md as local topics", () => {
    withSkills(
      {
        "sample/skills/index.md": "Read `not-a-topic.md`.\n",
        "sample/skills/not-a-topic/assets.md": "An asset alone is not a topic.",
      },
      (root) => {
        assert.equal(runSkillLayoutGate(root)[0]?.type, "unknown-topic");
      },
    );
  });

  it("requires every topic in the index body, ignoring mentions in description metadata", () => {
    withSkills(
      {
        "sample/skills/index.md":
          "---\ndescription: read unlisted-topic.md\n---\n\nPackage orientation.\n",
        "sample/skills/unlisted-topic/SKILL.md": "A real exported topic.\n",
      },
      (root) => {
        assert.deepEqual(
          runSkillLayoutGate(root).map(({ topic, type, relPath }) => ({ topic, type, relPath })),
          [
            {
              topic: "unlisted-topic",
              type: "unlisted-topic",
              relPath: "sample/skills/index.md",
            },
          ],
        );
      },
    );
  });

  it("rejects loose Markdown even in packages without an index", () => {
    withSkills(
      {
        "sample/skills/report-problem.md": "Guidance that would never ship.\n",
        "sample/skills/README.md": "A loose catalog.\n",
        "sample/skills/task/SKILL.md": "Exported as a flat skill.\n",
        "sample/skills/task/reference.md": "Topic assets are allowed.\n",
      },
      (root) => {
        assert.deepEqual(
          runSkillLayoutGate(root).map(({ topic, type, relPath }) => ({ topic, type, relPath })),
          [
            { topic: "README", type: "loose-markdown", relPath: "sample/skills/README.md" },
            {
              topic: "report-problem",
              type: "loose-markdown",
              relPath: "sample/skills/report-problem.md",
            },
          ],
        );
      },
    );
  });

  it("accepts complete grouped indexes, assets, flat packages and explicit foreign owners", () => {
    withSkills(
      {
        "sample/skills/index.md": [
          "---",
          "description: unrelated-example.md is metadata",
          "---",
          "",
          "Start with `first-task.md`.",
          "- **Utilities:** second-task, third-task",
          "The `overview` topic of the `warlock-js-other` skill.",
          "The `foreign-tool` topic of the\r\n`@warlock.js/other` package.",
          "The `same-owner` topic of the `@warlock.js/sample` package.",
          "The `fourth-task` topic of the `warlock-js-sample` skill.",
        ].join("\r\n"),
        "sample/skills/first-task/SKILL.md": "First task.",
        "sample/skills/first-task/reference.md": "An exported topic asset.",
        "sample/skills/second-task/SKILL.md": "Second task.",
        "sample/skills/third-task/SKILL.md": "Third task.",
        "sample/skills/same-owner/SKILL.md": "Same package.",
        "sample/skills/fourth-task/SKILL.md": "Fourth task.",
        "flat/skills/a-task/SKILL.md": "No index required for flat packages.",
        "no-skills/README.md": "Not a skill directory.",
      },
      (root) => {
        assert.deepEqual(runSkillLayoutGate(root), []);
        assert.deepEqual(runSkillPathRefsGate(root), []);
      },
    );
  });

  it("does not count a foreign topic with the same slug as local coverage", () => {
    withSkills(
      {
        "sample/skills/index.md": "The `shared-task` topic of the `warlock-js-other` skill.",
        "sample/skills/shared-task/SKILL.md": "Needs its own local orientation.",
      },
      (root) => {
        assert.equal(runSkillLayoutGate(root)[0]?.type, "unlisted-topic");
      },
    );
  });
});
