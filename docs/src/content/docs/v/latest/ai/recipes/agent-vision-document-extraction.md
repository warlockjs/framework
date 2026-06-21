---
title: "Recipe — Extract fields from a document image"
description: Attach a scanned invoice image to an agent, pull line items and totals into a typed schema, and handle the model-vision capability check.
sidebar:
  order: 11
  label: "Vision document extraction"
---

A supplier emails you a scanned invoice — a JPEG, not a PDF, not structured data. You need the invoice number, the supplier name, the line items, and the total, dropped into a typed record so your accounts system can reconcile it. There is no OCR step in your stack; you hand the image straight to a vision-capable model and ask it to read the fields out.

Two pieces matter:

1. **Attachments.** `agent.execute(input, { attachments })` accepts an image as a file path, a URL, or raw inline bytes (`{ type: "image", source: { base64, mediaType } }`). The agent resolves the source, builds a multipart user message, and hands it to the model.
2. **The vision capability gate.** Image attachments require the model to declare `vision` capability. `gpt-4o` and `gpt-4o-mini` auto-infer it from the model name; if you point an image at a non-vision model, the agent throws a clear `InvalidRequestError` up front instead of letting the provider return an opaque 400.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The schema

```ts
import { v } from "@warlock.js/seal";

const lineItemSchema = v.object({
  description: v.string(),
  quantity: v.int(),
  unitPrice: v.float(),
});

const invoiceSchema = v.object({
  invoiceNumber: v.string(),
  supplierName: v.string(),
  issueDate: v.string(),
  lineItems: v.array(lineItemSchema),
  total: v.float(),
  currency: v.string(),
});
```

## The agent

`gpt-4o` auto-infers vision capability, so no `vision: true` override is needed. (If you were pointing a fine-tuned or gateway model at this, you'd pass `openai.model({ name, vision: true })` to assert it explicitly.)

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const invoiceReader = ai.agent({
  name: "invoice-reader",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.systemPrompt()
    .persona("You read fields out of scanned invoice images.")
    .instruction("Transcribe exactly what the image shows — do not compute or correct totals.")
    .instruction("Use the currency symbol shown on the invoice to set the currency code (e.g. $ → USD, € → EUR)."),
});
```

## Run it — from a file path

The simplest case: the scan is on disk. Pass the path as a tagged image attachment so intent is explicit.

```ts
const { data, error } = await invoiceReader.execute(
  "Extract the invoice fields from this scan.",
  {
    attachments: [{ type: "image", source: "./invoices/inv-4821.jpg" }],
    output: invoiceSchema,
    repair: { maxAttempts: 1 },
  },
);

if (error) {
  console.error(`could not read invoice: ${error.message}`);
} else {
  console.log(data.invoiceNumber, data.supplierName, data.total, data.currency);
  for (const item of data.lineItems) {
    console.log(`  ${item.quantity} x ${item.description} @ ${item.unitPrice}`);
  }
}
```

## Run it — from inline bytes

When the image arrives over the wire (an upload buffer, an email attachment) and never touches disk, pass it as base64 with an explicit media type. No file path, no temp file.

```ts
import { readFile } from "node:fs/promises";

// In a real handler this buffer comes straight from the upload stream.
const bytes = await readFile("./invoices/inv-4821.jpg");

const { data, error } = await invoiceReader.execute(
  "Extract the invoice fields from this scan.",
  {
    attachments: [
      {
        type: "image",
        source: { base64: bytes.toString("base64"), mediaType: "image/jpeg" },
      },
    ],
    output: invoiceSchema,
  },
);
```

A remote URL works the same way — `source: "https://cdn.example.com/scans/inv-4821.jpg"` — and the agent auto-detects the URL form from the `https://` prefix.

## The capability error you'll hit if you get the model wrong

If you attach an image to a model that doesn't declare vision, the failure is loud and early:

```ts
const textOnly = ai.agent({
  name: "text-only",
  model: openai.model({ name: "gpt-3.5-turbo" }), // no vision
});

const { error } = await textOnly.execute("Read this", {
  attachments: ["./invoices/inv-4821.jpg"],
});

// error.message:
// Model "gpt-3.5-turbo" does not declare vision capability —
// image attachments are not supported
```

The check runs while building the input message, before any provider call — so you pay nothing and get a typed `InvalidRequestError` rather than a billed request that 400s.

## Production notes

- **Transcribe, don't compute.** The system prompt tells the model to read what's printed and not to re-derive the total. Vision models will happily "fix" arithmetic they think is wrong; for reconciliation you want the literal printed values, and you verify the math yourself downstream.
- **`structuredOutput` + vision compose cleanly.** `gpt-4o` supports both, so the schema is enforced natively while the image is read. The `output` schema still validates the result client-side into `data`.
- **Shorthand strings infer kind from the extension.** A bare `"./scan.jpg"` is treated as an image (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` are recognized); the tagged `{ type: "image", source }` form is clearer at the call site and avoids surprises with unusual extensions.
- **Keep one image per call for field extraction.** Multi-image prompts are supported (pass several attachments), but for "pull fields out of this one document" a single image keeps the model focused and the token cost predictable.
- **Cost is image-driven.** Vision tokens dominate the input usage here. Inspect `usage.input` per run if you're processing invoices at volume — downscaling oversized scans before encoding can cut the bill substantially.
