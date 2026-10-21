---
name: build-budgets
description: "Configure build.budgets in warlock.config.ts, inspect per-page gzip JS/CSS and deferred assets, compare the last build, and enforce limits with warlock build --json. Use for client bundle size regressions and CI transfer-size gates. For field metrics use web measure-web-vitals."
---

# Client build budgets

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  build: {
    budgets: {
      page: { js: "150kb", css: "50kb" },
      pages: { "/admin/**": { js: "220kb" } },
      mode: "error",
    },
  },
});
```

Run `npx warlock build` for the sorted table, or `npx warlock build --json`
for `{ success, budgets, error? }`. Progress goes to stderr in JSON mode.
`budgets` contains `version: 1`, `compression: "gzip"`, `pages` and
`violations`. API-only builds report an empty page list.

Page limits cover the hydration entry, page, layouts, root, setup registrations
and error boundary, plus their transitive static imports. Files are counted once
per page and gzipped individually. Dynamic imports beyond those required roots
are reported separately and do not consume the budget. Shared files count in
each page's first visit. This measures emitted JS/CSS, not HTML, fonts or images.

`pages` keys match route paths with `*` (within a segment), `**` (across
segments), or `?` (one non-slash character). Defaults apply first; matching rules
merge in insertion order and the last supplied field wins. Unsupported glob
syntax fails with an actionable error. Units are case-insensitive `b`, `kb` and
`mb`, with 1024 bytes per kb; equality passes. Omitted fields are unlimited.

Existing apps without budgets receive a report only. Configured budgets default
to `mode: "error"`; `"warn"` logs violations and completes. New project templates
configure 150kb JS / 50kb CSS. A failure names the page, limit, actual size and
the ten largest rendered modules. Those module sizes are Rollup attribution
estimates in uncompressed rendered bytes, not gzip shares; compression is not
additive across modules inside a file.

The successful build stores `build-budgets.json` in `build.outdir` (normally
`dist`). Preserve that directory before rebuilding to obtain deltas. A failed
build rolls back to the previous artifact and baseline. JSON output still
contains its attempted report. Changing output directories or deleting dist
starts a fresh baseline; new routes display no delta. Vite's private
`client/.vite/budget-modules.json` contains the full module attribution.
