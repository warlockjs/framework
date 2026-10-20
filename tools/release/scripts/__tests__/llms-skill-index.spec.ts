import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packagesRoot = fileURLToPath(new URL("../../../../packages/", import.meta.url));
const indexedPackages = readdirSync(packagesRoot).filter((name) =>
  existsSync(path.join(packagesRoot, name, "skills/index.md")),
);
const rootPackages = readdirSync(packagesRoot).filter((name) =>
  existsSync(path.join(packagesRoot, name, "skills/SKILL.md")),
);

async function generate(root: string): Promise<void> {
  const child = spawn(process.execPath, ["scripts/generate-llms.mjs"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const pid = child.pid;
  let diagnostics = "";
  child.stderr.on("data", (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`LLM generator ${pid} exited ${code ?? signal}: ${diagnostics}`));
      });
    });
  } finally {
    if (pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill();
  }
}

describe("package LLM skill projections", () => {
  for (const packageDir of rootPackages) {
    it(`${packageDir} projects the root skill and sibling assets at published paths`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "llms-root-skill-"));
      try {
        mkdirSync(path.join(root, "scripts"));
        mkdirSync(path.join(root, "skills"));
        writeFileSync(
          path.join(root, "scripts", "generate-llms.mjs"),
          readFileSync(path.join(packagesRoot, packageDir, "scripts", "generate-llms.mjs")),
        );
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({
            name: "@warlock.js/sample",
            description: "Sample package.",
            type: "module",
          }),
        );
        writeFileSync(
          path.join(root, "skills", "SKILL.md"),
          '---\nname: warlock-js-sample\ndescription: "Root package description"\n---\n\nComplete root instructions.\n',
        );
        writeFileSync(path.join(root, "skills", "reference.md"), "Root reference content.\n");

        await generate(root);
        const index = readFileSync(path.join(root, "llms.txt"), "utf8");
        const full = readFileSync(path.join(root, "llms-full.txt"), "utf8");
        assert.match(
          index,
          /\[sample\]\(@warlock\.js\/sample\/skills\/SKILL\.md\): Root package description/,
        );
        assert.match(full, /Complete root instructions/);
        assert.match(full, /@warlock\.js\/sample\/skills\/reference\.md/);
        assert.match(full, /Root reference content/);
        assert.doesNotMatch(index, /skills\/sample\/SKILL\.md|skills\/index\.md/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const packageDir of indexedPackages) {
    it(`${packageDir} projects index orientation and topic assets without an overview folder`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "llms-skill-index-"));
      try {
        mkdirSync(path.join(root, "scripts"));
        mkdirSync(path.join(root, "skills", "real-task"), { recursive: true });
        writeFileSync(
          path.join(root, "scripts", "generate-llms.mjs"),
          readFileSync(path.join(packagesRoot, packageDir, "scripts", "generate-llms.mjs")),
        );
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({
            name: "@warlock.js/sample",
            description: "Sample package.",
            type: "module",
          }),
        );
        writeFileSync(
          path.join(root, "skills", "index.md"),
          '---\ndescription: "Package orientation description"\n---\n\nUnique orientation, preserved after merging. Read `real-task.md`.\n',
        );
        writeFileSync(
          path.join(root, "skills", "real-task", "SKILL.md"),
          '---\nname: real-task\ndescription: "Real task description"\n---\n\nDetailed task instructions.\n',
        );
        writeFileSync(
          path.join(root, "skills", "real-task", "reference.md"),
          "Topic asset content.\n",
        );

        await generate(root);
        const index = readFileSync(path.join(root, "llms.txt"), "utf8");
        const full = readFileSync(path.join(root, "llms-full.txt"), "utf8");
        assert.match(
          index,
          /\[Package orientation\]\(@warlock\.js\/sample\/skills\/index\.md\): Package orientation description/,
        );
        assert.match(index, /Real task description/);
        assert.match(full, /Unique orientation, preserved after merging/);
        assert.match(full, /Detailed task instructions/);
        assert.match(full, /Topic asset content/);
        assert.doesNotMatch(index, /overview\/SKILL\.md/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
