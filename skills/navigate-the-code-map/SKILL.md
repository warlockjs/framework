---
name: navigate-the-code-map
description: Find which file holds which code or documentation in the Warlock.js monorepo using the generated code map (code-map/FILE_INDEX.md, code-map/GRAPH_REPORT.md and the graphify query CLI), and regenerate it with pnpm code-map.
---

# Navigate the code map

The repository carries a generated map of `packages/*`, `docs/`, `tools/release/`, `scripts/`
and `skills/`. It is built from the syntax tree of each file (and the headings and frontmatter of
Markdown pages). No model or API key is involved, so it is cheap to rebuild and never invents
facts. Read it before grepping blindly.

## Read in this order

1. `code-map/FILE_INDEX.md` - one line per source file: its path and its main symbols (classes
   first), or for docs pages the title and description. Grouped by package or docs section. Search it
   for a keyword (`grep -n "supervisor" code-map/FILE_INDEX.md`) to learn which file owns a concept.
   Test files are counted per group, not listed; they sit next to the code they cover.
2. `code-map/GRAPH_REPORT.md` - the shape of the whole codebase: community hubs, the most connected
   symbols, surprising cross-package links.
3. `code-map/graph.json` - the full graph (local only, not committed; created by `pnpm code-map`).
   Query it with the CLI below.

## Query the graph

Run from the repository root. Use the venv binary; never run `graphify install` or `graphify hook install`
(they write outside the repository).

```bash
G=tools/code-map/.venv/bin/graphify
$G query "how are tool calls dispatched" --graph code-map/graph.json --budget 1500
$G explain "packages/ai/src/agent/agent.ts::agent()" --graph code-map/graph.json
$G path "Model" "MongoQueryBuilder" --graph code-map/graph.json
$G affected "Request" --graph code-map/graph.json      # what depends on a symbol
$G god-nodes --top 20 --graph code-map/graph.json       # architectural hubs
```

An ambiguous name exits with code 3 and lists candidates; retry with `path::symbol`. Exit 4
means nothing matched: try a different word or grep `FILE_INDEX.md`.

## Regenerate

```bash
pnpm code-map            # same as: bash scripts/code-map.sh
bash scripts/code-map.sh --rebuild   # drop the cache first
```

The first run creates `tools/code-map/.venv` and installs the versions pinned in
`tools/code-map/requirements.txt`. Later runs reuse the cache in `code-map/cache`. A cold build
takes a few minutes; a warm one about a minute and a half. Rebuild after code lands and before relying on
the map for recently changed files. The report names the commit it was built from.

## What it covers and what it does not

- Covered: TypeScript/JavaScript symbols, imports and calls; Markdown and MDX pages (title,
  description, headings); skills; workspace scripts.
- Not covered: semantic summaries of docs prose (that needs a model), generated declarations
  (`*.d.ts`), JSON/YAML data files, vendored bundles, archived docs versions, lockfiles, and anything
  git-ignored. Private working notes are excluded on purpose (see `.graphifyignore`).
- Call edges are inferred from names; treat an `INFERRED` edge as a lead to confirm in the source.

To exclude more paths, add them to `.graphifyignore` at the repository root.
