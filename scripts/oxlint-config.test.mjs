import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shared oxlint config catches correctness errors and accepts a clean TypeScript module", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-oxlint-"));
  try {
    const file = path.join(directory, "example.ts");
    const run = () =>
      spawnSync(
        path.join(root, "node_modules/.bin/oxlint"),
        ["--config", path.join(root, ".oxlintrc.json"), "--format", "json", file],
        { encoding: "utf8", cwd: root },
      );
    writeFileSync(file, "const count = 0; count = 1; export { count };\n");
    const failing = run();
    assert.equal(failing.status, 1, failing.stderr);
    assert.match(failing.stdout, /no-const-assign/);
    writeFileSync(file, "export const count = 1;\n");
    const passing = run();
    assert.equal(passing.status, 0, passing.stderr);
    assert.deepEqual(JSON.parse(passing.stdout).diagnostics, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("correctness checks retain unsafe access and unused-local errors while permitting intentional conventions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-oxlint-conventions-"));
  try {
    const file = path.join(directory, "example.ts");
    const run = (source) => {
      writeFileSync(file, source);
      return spawnSync(
        path.join(root, "node_modules/.bin/oxlint"),
        ["--config", path.join(root, ".oxlintrc.json"), "--format", "json", file],
        { encoding: "utf8", cwd: root },
      );
    };
    const unsafe = run(
      "export function read(input?: { value: { name: string } }) { const { name } = input?.value; return name; }\n",
    );
    assert.equal(unsafe.status, 1, unsafe.stderr);
    assert.match(unsafe.stdout, /no-unsafe-optional-chaining/);
    const unused = run("export function read() { const forgotten = 1; return 2; }\n");
    assert.equal(unused.status, 1, unused.stderr);
    assert.match(unused.stdout, /no-unused-vars/);
    const conventions = run(`
      import { createElement } from "react";
      export function overrideHook(options: unknown): void {}
      export function render(callbacks: Set<() => void>, props?: object) {
        for (const callback of [...callbacks]) callback();
        const values = new Array(2).fill(0);
        try { JSON.parse("invalid"); } catch (error) {}
        const { hidden, ...rest } = { hidden: true, ...props };
        return createElement("div", { ...rest, children: values.join(",") });
      }
    `);
    assert.equal(conventions.status, 0, conventions.stderr);
    assert.equal(
      JSON.parse(conventions.stdout).diagnostics.filter((item) => item.severity === "error").length,
      0,
    );
    const suggestion = run("export const starts = (value: string) => /^prefix/.test(value);\n");
    assert.equal(suggestion.status, 0, suggestion.stderr);
    assert.ok(
      JSON.parse(suggestion.stdout).diagnostics.some(
        (item) =>
          item.severity === "warning" && item.code === "unicorn(prefer-string-starts-ends-with)",
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
