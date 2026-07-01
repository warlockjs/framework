---
title: "RAG loaders and stores"
description: The ai.rag.* loaders (loadText / loadHtml / loadWeb / loadPdf) that turn any source into the RagDocument[] a knowledge base indexes, and the swappable pgVectorStore / cacheVectorStore backends that hold the embeddings.
sidebar:
  order: 16
  label: "RAG loaders and stores"
---

Two feature groups bracket [`ai.rag()`](../the-basics/run-rag): **loaders** turn a source — a string, raw HTML, a URL, or PDF bytes — into the exact `RagDocument[]` shape that `kb.index()` consumes, and **stores** are the swappable backends that hold the embeddings. Both live on the `ai.rag.*` namespace, present the moment `@warlock.js/ai` is imported — no side-effect import, no module augmentation.

The point is that a load feeds `index()` with **no adapter**: a loader already returns `RagDocument[]`, so callers never branch on arity (one page is one doc, a per-page PDF is N docs), and a store already satisfies the same contract the pipeline calls under the hood.

## The two contracts

Every loader returns `RagLoaderResult` — a plain array of documents:

```ts
type RagLoaderResult = RagDocument[];
type RagDocument = { id: string; text: string; metadata?: Record<string, unknown>; tags?: string[] };
```

Every store satisfies the three-method `VectorStore` contract — a thin narrowing of the cache `similar()` surface, not a new engine:

```ts
interface VectorStore {
  upsert(key: string, value: unknown, vector: number[], tags?: string[]): Promise<void>;
  query<T>(vector: number[], options: { topK: number; threshold?: number; tags?: string[] }): Promise<{ key: string; value: T; score: number }[]>;
  removeNamespace(namespace: string): Promise<void>;
}
```

## Loaders

| Loader | Input | Deps | Emits |
| --- | --- | --- | --- |
| `ai.rag.loadText(input, opts?)` | `string` \| `{ id, text }` \| array of either | none | one doc per non-empty item |
| `ai.rag.loadHtml(html, opts?)` | raw HTML string | none (regex strip) | one doc, `metadata.title` from `<title>` |
| `ai.rag.loadWeb(url, opts?)` | absolute URL | none (core `guardedFetch`) | one doc, SSRF-safe fetch |
| `ai.rag.loadPdf(bytes, opts?)` | `Buffer` \| `ArrayBuffer` \| `Uint8Array` | lazy `pdf-parse` peer | one doc, or one per page with `perPage: true` |

All four accept the shared `RagLoaderOptions`: `id` (source id — falls back to the URL for web, `"document"` otherwise), `metadata` (merged **over** the loader-derived keys, so an explicit `metadata.title` always wins), and `tags` (applied to every chunk for `retrieve({ tags })` filtering). Loader-derived keys include `source`, `loader` (`"text" | "html" | "web" | "pdf"`), plus `title` / `page` / `pageCount` / `contentType` where determinable.

```ts
import { ai } from "@warlock.js/ai";

// A bare string, or many records → many distinctly-identified docs:
await kb.index(ai.rag.loadText([
  { id: "faq-billing", text: "…", metadata: { section: "billing" } },
  { id: "faq-shipping", text: "…" },
]));

// Raw HTML → readable text (scripts/styles dropped, entities decoded):
await kb.index(ai.rag.loadHtml(rawHtml, { id: "landing", tags: ["marketing"] }));
```

:::note
Empty, whitespace-only, or all-markup input emits **no** document — never a no-op record for `index()` to skip. A fully-scanned PDF with no text layer yields zero docs.
:::

### `loadWeb` is SSRF-safe — never a raw `fetch`

Every request goes through core's `guardedFetch` under an `OutboundPolicy`. The strict defaults — https-only, private-IP-deny on, 10s timeout, 5 MiB cap — apply even when you pass no `policy`, so an untuned call is already hardened. Tighten it per call:

```ts
await kb.index(await ai.rag.loadWeb("https://docs.example.com/guide", {
  policy: { hostAllowlist: ["docs.example.com"], maxBytes: 2_000_000, timeoutMs: 5_000 },
  tags: ["docs"],
}));
```

HTML responses run through the same tag-strip pass as `loadHtml`; non-HTML text (`text/plain`, markdown) is used verbatim. `metadata.source` is the resolved URL and `metadata.contentType` the server-reported type. A non-OK response, a policy block, a timeout, or an over-cap body throws `OutboundPolicyError`.

### `loadPdf` — lazy optional peer, page-precise citations

`pdf-parse` is an **optional** peer, dynamic-imported on the first `loadPdf` call — importing `@warlock.js/ai` never forces it. When it is absent, the curated `PDF_PARSE_INSTALL_INSTRUCTIONS` string is thrown as a plain `Error` (a missing infra peer, not a content problem), never a raw module-resolution stack trace.

```ts
import { readFile } from "node:fs/promises";

// Whole PDF → one doc carrying metadata.pageCount:
await kb.index(await ai.rag.loadPdf(await readFile("manual.pdf"), { id: "manual" }));

// One doc per page → citations stay page-precise (id suffixed `#p<n>`, metadata.page set):
await kb.index(await ai.rag.loadPdf(bytes, { id: "manual", perPage: true }));
```

## Stores

### `ai.rag.cacheVectorStore(driver)` — adapt any cache driver

The `@warlock.js/cache` driver **is** the vector store: `upsert → set({ vector, tags })`, `query → similar()`, `removeNamespace → removeNamespace()`. A driver without similarity support throws `CacheUnsupportedError` unchanged, pointing you at the `pg` / `redis` cache drivers.

```ts
import { MemoryCacheDriver } from "@warlock.js/cache";

const store = ai.rag.cacheVectorStore(new MemoryCacheDriver()); // dev / tests
```

### `ai.rag.pgVectorStore(options)` — production pgvector

One durable row per chunk keyed by the pipeline's dotted key, the chunk payload in a `JSONB` `value` column, the embedding in a pgvector `vector` column. Pass a live pool (`{ client }` — `@warlock.js/ai` imports **nothing**) or a `{ connectionString }` and let the store lazily `import("pg")`. Exactly one of the two is required.

```ts
type PgVectorStoreOptions = {
  client?: PgClientLike;               // a pg.Pool / pg.Client — only `query` is ever called
  connectionString?: string;           // else the store builds its own Pool lazily
  table?: string;                      // default "warlock_ai_rag_vectors"; must be a safe identifier
  dimensions?: number;                 // vector(N) width in the DDL, default 1536
  index?: "hnsw" | "ivfflat" | "none"; // ANN strategy, default "hnsw"
  ivfflatLists?: number;               // ivfflat only, default 100
};
```

`schema()` (alias `ensureSchema()`) returns the reference migration DDL — `CREATE EXTENSION vector`, the table, a GIN index on `tags`, and the chosen ANN index. It **only returns the string**; the framework never auto-migrates — you run it once through your own tool.

```ts
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = ai.rag.pgVectorStore({ client: pool, dimensions: 1536, index: "hnsw" });

// Once, via your migration tooling — never auto-run:
await pool.query(store.ensureSchema());
```

:::caution
Index and query MUST use the same embedding model. The `vector(N)` width is fixed at table-creation time from `dimensions`, so the `embedder`'s dimensions MUST equal the store's — a mismatch is a runtime insert failure at the pgvector column, not a type error.
:::

`query()` runs the cosine floor (`threshold`) and `tags` overlap filter **in SQL** — a below-floor row never crosses the wire — orders by cosine distance, caps at `topK`, and maps the pgvector distance back to a `[0,1]` similarity `score`, the same scale the cache store emits. `removeNamespace()` is a prefix DELETE that escapes `_` / `%`, so dropping `ai.rag.docs` never also catches `ai.rag.docs2`.

## Real-world — a knowledge base from a website, backed by pgvector

Crawl a few pages (SSRF-safe) and a spec PDF into one namespace, then retrieve with page-precise citations:

```ts
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const store = ai.rag.pgVectorStore({ client: pool, dimensions: 1536 });
await pool.query(store.ensureSchema()); // once at boot / migration

const kb = ai.rag({
  name: "docs",
  embedder: openai.embedder({ name: "text-embedding-3-small" }), // 1536 dims — matches the DDL
  store,
});

for (const url of ["https://docs.example.com/intro", "https://docs.example.com/config"]) {
  await kb.index(await ai.rag.loadWeb(url, { policy: { hostAllowlist: ["docs.example.com"] }, tags: ["docs"] }));
}
await kb.index(await ai.rag.loadPdf(await readFile("spec.pdf"), { id: "spec", perPage: true, tags: ["spec"] }));

// Every hit's citation traces back to its source URL / page:
const { chunks } = await kb.retrieve("how do I configure caching?", { topK: 4, tags: ["docs"] });
```

Loaders are cheap — `loadText` / `loadHtml` are zero-dependency string passes, `loadWeb` costs one guarded round-trip, `loadPdf` costs the parse. **None embed**: the token spend lands entirely in `kb.index()` (batched, 96 texts per `embedMany` call), so `perPage` PDFs and finer chunking mean more, smaller vectors. For tests, drive `cacheVectorStore(new MemoryCacheDriver())` for a real end-to-end index/retrieve with no external service.

## Related

- [Run RAG](../the-basics/run-rag) — the chunk → embed → retrieve → rerank → cite pipeline that **consumes** these loaders and stores.
- [Embed text](../the-basics/embed-text) — the `sdk.embedder` primitive whose `dimensions` must match the store's `vector(N)` width.
- [Persist AI data](./persist-ai-data) — the semantic-cache vector store, wired from the same `@warlock.js/cache` drivers.
- [Outbound policy](./outbound-policy) — the `OutboundPolicy` and `guardedFetch` that make `loadWeb` SSRF-safe.
