import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODEMODS } from "./codemods";
import { runUpgrade } from "./run-upgrade";

/**
 * Fixture layout, one folder per codemod under `tests/fixtures/upgrade/<id>/`:
 *
 * - `input/` — an app tree; every file carries an extra `.txt` suffix so the
 *   fixtures are never type-checked or linted as part of core;
 * - `expected/` — the tree after the codemod (omitted when it edits nothing);
 * - `manual.json` — the `{ file, line }` of every place it lists for review.
 */
const fixturesRoot = path.resolve(__dirname, "../../tests/fixtures/upgrade");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function listFiles(directory: string, prefix = ""): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    return statSync(absolute).isDirectory() ? listFiles(absolute, relative) : [relative];
  });
}

/** Copy `input/` into a temporary app, dropping the `.txt` suffixes. */
function materialize(fixture: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `warlock-upgrade-${fixture}-`));
  roots.push(root);
  const input = path.join(fixturesRoot, fixture, "input");
  for (const file of listFiles(input)) {
    const target = path.join(root, file.replace(/\.txt$/, ""));
    cpSync(path.join(input, file), target, { recursive: true });
  }
  return root;
}

describe.each(CODEMODS.map((codemod) => codemod.id))("codemod %s", (id) => {
  it("turns its fixture into the expected tree and lists the expected review sites", async () => {
    const codemod = CODEMODS.find((candidate) => candidate.id === id);
    if (!codemod) throw new Error(`Unknown codemod ${id}`);
    const fixtureDir = path.join(fixturesRoot, id);
    expect(existsSync(fixtureDir), `missing fixture folder for ${id}`).toBe(true);

    const root = materialize(id);
    const before = new Map(
      listFiles(root).map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
    );

    const result = await runUpgrade({
      root,
      from: "5.29.0",
      to: codemod.version === "target" ? "5.31.0" : codemod.version,
      codemods: [codemod],
    });

    const expectedDir = path.join(fixtureDir, "expected");
    if (existsSync(expectedDir)) {
      for (const file of listFiles(expectedDir)) {
        const target = file.replace(/\.txt$/, "");
        expect(readFileSync(path.join(root, target), "utf8"), target).toBe(
          readFileSync(path.join(expectedDir, file), "utf8"),
        );
      }
    } else {
      for (const [file, content] of before) {
        expect(readFileSync(path.join(root, file), "utf8"), file).toBe(content);
      }
      expect(result.applied).toEqual([]);
    }

    const expectedManual = JSON.parse(
      readFileSync(path.join(fixtureDir, "manual.json"), "utf8"),
    ) as { file: string; line: number }[];
    expect(result.manual.map(({ file, line }) => ({ file, line }))).toEqual(expectedManual);
    for (const item of result.manual) {
      expect(item.codemod).toBe(id);
      expect(item.hint.length).toBeGreaterThan(20);
    }
  });
});

describe("codemod registry", () => {
  it("has unique ids, a version, a package and a skill for each", () => {
    const ids = CODEMODS.map((codemod) => codemod.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const codemod of CODEMODS) {
      expect(codemod.version === "target" || /^\d+\.\d+\.\d+$/.test(codemod.version)).toBe(true);
      expect(codemod.package).toMatch(/^@warlock\.js\//);
      expect(codemod.skill).toBeTruthy();
    }
  });
});
