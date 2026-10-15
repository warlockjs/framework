import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { insertIncludeEntry } from "../../../src/generations/features/shared/patch-tsconfig-include";

/**
 * `warlock add react-email` failed on EVERY freshly scaffolded app, because it
 * read the project's `tsconfig.json` with `JSON.parse` and that file is JSONC —
 * TypeScript accepts `//` comments there and `JSON.parse` does not:
 *
 * ```
 * ✖ add <features...> failed
 * Expected double-quoted property name in JSON at position 454 (line 17 column 5)
 * ```
 *
 * These assertions run against the REAL scaffold template, not a synthetic
 * fixture, because the defect was a property of that exact file. A fixture
 * written to match today's template would keep passing the day the template
 * gains another comment.
 */
const TEMPLATE_TSCONFIG = path.resolve(
  __dirname,
  "../../../../create-warlock/templates/warlock/tsconfig.json",
);

describe("tsconfig include patching survives the template's own comments", () => {
  const template = readFileSync(TEMPLATE_TSCONFIG, "utf8");

  it("proves the premise: the real scaffold template is JSONC and JSON.parse rejects it", () => {
    expect(template).toMatch(/^\s*\/\//m);
    expect(() => JSON.parse(template)).toThrow();
  });

  it("adds the entry to the real template", () => {
    const result = insertIncludeEntry(template, "emails");

    expect(result.status).toBe("added");
    expect(result.status === "added" && result.next).toMatch(/"include"\s*:\s*\["emails",/);
  });

  it("keeps every comment in the file — they are the documentation, and a parse-and-write would delete them", () => {
    const result = insertIncludeEntry(template, "emails");
    const commentsBefore = template.match(/^\s*\/\/.*$/gm) ?? [];
    const commentsAfter =
      (result.status === "added" ? result.next : "").match(/^\s*\/\/.*$/gm) ?? [];

    expect(commentsBefore.length).toBeGreaterThan(0);
    expect(commentsAfter).toEqual(commentsBefore);
  });

  it("leaves the rest of the file byte-identical apart from the inserted entry", () => {
    const result = insertIncludeEntry(template, "emails");
    const restored =
      result.status === "added" ? result.next.replace('"emails", ', "") : "<not added>";

    expect(restored).toBe(template);
  });

  it("is idempotent — a second add does not stack a duplicate", () => {
    const once = insertIncludeEntry(template, "emails");
    const twice = insertIncludeEntry(once.status === "added" ? once.next : "", "emails");

    expect(twice.status).toBe("already-present");
  });

  it("reports rather than throws when there is no include array to patch", () => {
    expect(insertIncludeEntry('{ "compilerOptions": {} }', "emails").status).toBe("unrecognised");
  });
});
