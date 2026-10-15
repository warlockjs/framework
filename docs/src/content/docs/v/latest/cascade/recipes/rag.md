---
title: "RAG — retrieval-augmented generation"
sidebar:
  order: 10
  label: "RAG — retrieval-augmented generation"
---

Retrieval-augmented generation: find the most relevant chunks of your content, hand them to the LLM as context, generate the answer. Cascade owns the storage and retrieval halves — the embedding model and the LLM live in your AI module.

This recipe focuses on Cascade's part: the vector model, the indexing service, and the retrieval service. The AI calls are shown as pseudo-imports so the pattern stays focused on the data layer.

## The vector model

One row per chunk of indexed content:

```ts
import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";

export const knowledgeChunkSchema = v.object({
  contentId: v.string(),
  contentType: v.string(),
  chunkIndex: v.number(),
  text: v.string(),
  embedding: v.any(),
});

type KnowledgeChunkSchema = Infer<typeof knowledgeChunkSchema>;

@RegisterModel()
export class KnowledgeChunk extends Model<KnowledgeChunkSchema> {
  public static table = "knowledge_chunks";
  public static schema = knowledgeChunkSchema;
}
```

`contentId` + `contentType` point back at the source document (a `Faq`, an `Article`, a `Product` — whatever you're indexing). `chunkIndex` orders the chunks within one document. `embedding` holds the vector — declared with `v.any()` here since the shape varies; in the migration it's a real `vector(1536)` column with `.vectorIndex({ similarity: "cosine" })`.

## Indexing — write chunks at content-change time

A service that takes a piece of content, splits it, embeds each chunk, stores the rows:

```ts
import { KnowledgeChunk } from "../models/knowledge-chunk/knowledge-chunk.model";
import { embed } from "app/ai/services/embed.service";
import { splitIntoChunks } from "app/ai/utils/split-into-chunks";

type IndexContentInput = {
  contentId: string;
  contentType: string;
  text: string;
};

export async function indexContent(input: IndexContentInput) {
  await KnowledgeChunk.where("contentId", input.contentId)
    .where("contentType", input.contentType)
    .delete();

  const chunks = splitIntoChunks(input.text);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunkText = chunks[chunkIndex];
    const embedding = await embed(chunkText);

    await KnowledgeChunk.create({
      contentId: input.contentId,
      contentType: input.contentType,
      chunkIndex,
      text: chunkText,
      embedding,
    });
  }
}
```

Two patterns worth noticing:

- **Delete-then-rewrite** for re-indexing. When the source document changes, the cheapest thing to do is drop all its chunks and create fresh ones — chunk boundaries shift as text changes, so trying to update in place gets complicated.
- **Embed per chunk, not per document.** Each chunk gets its own vector. The size of the chunk depends on your model's token limit and the granularity you want — typically 200-500 tokens.

Wire the indexing into the source model's `onSaved` event so content stays in sync:

```ts
import { Faq } from "../models/faq/faq.model";
import { indexContent } from "../services/index-content.service";

Faq.events().onSaved(async (faq) => {
  await indexContent({
    contentId: String(faq.id),
    contentType: "faq",
    text: faq.get("body") as string,
  });
});
```

For high-write content, push this through the [outbox pattern](./outbox-pattern.md) — embedding is slow and shouldn't block the save path.

## Retrieval — find the closest chunks

The query service: embed the question, run `.similarTo()`, return the top K with their text:

```ts
import { KnowledgeChunk } from "../models/knowledge-chunk/knowledge-chunk.model";
import { embed } from "app/ai/services/embed.service";

type RetrieveInput = {
  question: string;
  contentType?: string;
  limit?: number;
};

export async function retrieveChunks(input: RetrieveInput) {
  const queryEmbedding = await embed(input.question);
  const query = KnowledgeChunk.query();

  if (input.contentType) {
    query.where("contentType", input.contentType);
  }

  return query
    .similarTo("embedding", queryEmbedding)
    .limit(input.limit ?? 5)
    .get<KnowledgeChunkRow & { score: number }>();
}

type KnowledgeChunkRow = {
  contentId: string;
  contentType: string;
  chunkIndex: number;
  text: string;
};
```

`.similarTo` does two things to the query: it adds the similarity score as a SELECT field, and orders by distance so the vector index can be used. See the [Vector search guide](../digging-deeper/vector-search.md) for the mechanics.

`limit` is essentially required — vector search is built around top-K. Without a limit, you'd score every chunk in the table.

## Putting it together — the RAG service

```ts
import { retrieveChunks } from "./retrieve-chunks.service";
import { generateAnswer } from "app/ai/services/generate-answer.service";

type AnswerInput = {
  question: string;
  contentType?: string;
};

export async function answerWithContext(input: AnswerInput) {
  const chunks = await retrieveChunks({
    question: input.question,
    contentType: input.contentType,
    limit: 5,
  });

  const context = chunks.map((chunk) => chunk.text).join("\n\n---\n\n");

  return generateAnswer({
    question: input.question,
    context,
  });
}
```

Three steps, each in its own service: retrieve, format, generate. Swapping the embedding model, the LLM, or the chunking strategy means touching one file each — not threading new args through the entire pipeline.

## Filtering before similarity is the cheap path

When the corpus is large (>100k chunks) and you can narrow the candidate set with regular `where` clauses, do that **before** `.similarTo()`:

```ts
return query
  .where("contentType", "faq")
  .where("organizationId", currentOrganization.id)
  .similarTo("embedding", queryEmbedding)
  .limit(5)
  .get();
```

The database eliminates non-matching rows on regular indexes first, then scores the remainder. Much cheaper than scoring everything and then filtering.

## Going further

- **Vector search mechanics** — [Vector search guide](../digging-deeper/vector-search.md)
- **Hybrid search** combining vector + full-text — [Hybrid search recipe](./hybrid-search.md)
- **MongoDB Atlas vector index setup** — [Atlas vector setup recipe](./mongodb-atlas-vector-setup.md)
- **Outbox for async indexing** — [Outbox pattern recipe](./outbox-pattern.md)
