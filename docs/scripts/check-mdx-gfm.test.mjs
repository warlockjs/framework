import assert from "node:assert/strict";
import { test } from "node:test";
import { findRawTables } from "./check-mdx-gfm.mjs";

test("flags a table that rendered as a paragraph", () => {
  const html = "<p>| File | Path | | --- | --- | | <code>a.ts</code> | <code>/a</code> |</p>";
  assert.equal(findRawTables(html).length, 1);
});

test("accepts rendered tables and tables inside code blocks", () => {
  const html =
    "<table><tr><th>File</th></tr></table><pre><code>| a |\n| --- |</code></pre><p>a | b</p>";
  assert.deepEqual(findRawTables(html), []);
});
