/**
 * Copies a fixture project to a temporary folder, so a spec can break one
 * file (for a failure case) or let a builder write into it, without touching
 * the committed fixture.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { shopRoot } from "../fixtures/shop-facts";

/** A temporary copy of a fixture project. */
export type FixtureCopy = {
  /** Absolute root of the copy. */
  root: string;
  /** Read a project-relative file of the copy. */
  read(file: string): string;
  /** Write a project-relative file of the copy. */
  write(file: string, content: string): void;
  /** Replace text in a project-relative file; throws when `search` is not there. */
  replace(file: string, search: string, replacement: string): void;
  /** Delete the copy. */
  remove(): void;
};

/** Copy `source` (default: the `shop` fixture) to a new temporary folder. */
export function copyFixture(source: string = shopRoot): FixtureCopy {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-fixture-"));

  cpSync(source, root, { recursive: true });

  const absolute = (file: string): string => path.join(root, ...file.split("/"));

  return {
    root,
    read: (file) => readFileSync(absolute(file), "utf8"),
    write: (file, content) => writeFileSync(absolute(file), content),
    replace(file, search, replacement) {
      const text = readFileSync(absolute(file), "utf8");

      if (!text.includes(search))
        throw new Error(`${file} does not contain ${JSON.stringify(search)}`);

      writeFileSync(absolute(file), text.replace(search, replacement));
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
