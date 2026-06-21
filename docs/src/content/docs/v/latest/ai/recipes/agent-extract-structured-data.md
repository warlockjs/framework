---
title: "Recipe — Extract structured data with self-repair"
description: Parse a messy pasted resume into a typed schema, validate it with @warlock.js/seal, and let the agent re-ask itself when the first response fails validation.
sidebar:
  order: 10
  label: "Extract structured data"
---

You run an applicant-tracking import. Recruiters paste raw resume text — copied out of a PDF, an email body, or a LinkedIn profile — and you need a clean, typed record: name, email, years of experience, and a list of skills. The text is never consistent. Sometimes the email is missing, sometimes "experience" is buried in a sentence, sometimes the model returns prose around the JSON.

Two things make this robust instead of brittle:

1. A **`v` schema** describing the exact shape you want. The agent extracts the JSON Schema from it, asks the model for structured output, then validates the model's response against the same schema — so a malformed field is caught before it reaches your database.
2. **`repair: { maxAttempts }`** — when validation fails, the agent feeds the bad response plus the validation error back to the model and re-asks, up to N times. The recruiter never sees the retry; they get a clean record or a typed error.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The schema

`@warlock.js/seal`'s `v` builder is Standard Schema-compatible, so the agent can both extract a JSON Schema from it (to drive native structured-output mode) and validate the model's response against it.

```ts
import { v } from "@warlock.js/seal";

const resumeSchema = v.object({
  fullName: v.string(),
  email: v.string().email(),
  yearsOfExperience: v.int(),
  skills: v.array(v.string()),
  currentTitle: v.string().optional(),
});
```

## The agent

The model here is `gpt-4o-mini`, which advertises `structuredOutput` capability — so the agent sends the extracted JSON Schema as a native `response_format` rather than padding the system prompt with a soft instruction. You still pass the `v` schema as `output`; that's what drives client-side validation into `result.data`.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const resumeExtractor = ai.agent({
  name: "resume-extractor",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You extract structured candidate data from raw resume text.")
    .instruction("Pull the candidate's full name, email, total years of professional experience, and skills.")
    .instruction("If a field is genuinely absent from the text, omit optional fields; never invent an email or a number."),
});
```

## Run it

The raw text below is the kind of thing a recruiter actually pastes — line breaks in the wrong places, the email run together with a phone number, experience expressed as a sentence.

```ts
const rawResume = `
Sara El-Masry  | Senior Frontend Engineer
sara.elmasry@example.com  +20 100 555 0199
About: 8 years building React and TypeScript apps at fintech startups.
Stack: React, TypeScript, Next.js, GraphQL, Tailwind, Vitest
`;

const { data, error, report } = await resumeExtractor.execute(rawResume, {
  output: resumeSchema,
  repair: { maxAttempts: 2 },
});

if (error) {
  // Validation still failed after every repair attempt — surface a typed error,
  // don't push a half-parsed record downstream.
  console.error(`extraction failed: ${error.code} — ${error.message}`);
} else {
  // `data` is fully typed and validated against resumeSchema.
  console.log(data.fullName);          // "Sara El-Masry"
  console.log(data.email);             // "sara.elmasry@example.com"
  console.log(data.yearsOfExperience); // 8
  console.log(data.skills);            // ["React", "TypeScript", ...]
}

console.log(`took ${report.duration}ms across ${report.trips.length} trip(s)`);
```

## What self-repair actually does

When the model's first response fails to parse as JSON or fails schema validation, and `repair` is set, the agent:

1. Appends the bad assistant response to the conversation so the model can see exactly what it produced.
2. Appends a corrective user message naming the validation error (e.g. `email: must be a valid email`).
3. Runs another trip and re-validates.

Each repair attempt counts as a normal trip and is bounded by the agent's `maxTrips` cap, so a model stuck producing garbage can't loop forever. The final outcome — a clean `data` or the last validation `error` — is what surfaces.

If you want to observe the retry, subscribe to trip events:

```ts
const { data } = await resumeExtractor.execute(rawResume, {
  output: resumeSchema,
  repair: { maxAttempts: 2 },
  on: {
    "agent.trip.completed": ({ trip }) => {
      console.log(`trip ${trip.index}: ${trip.finishReason}`);
    },
  },
});
```

:::note
`repair` only does anything when `output` (or `responseSchema`) is set — it repairs *validation* failures, not tool-call loops or provider errors. Without a schema there is nothing to validate, so the option is ignored.
:::

## Production notes

- **`execute()` never throws.** A validation failure that survives every repair attempt lands on `result.error` as a `SchemaValidationError`, with the original issues preserved under `error.issues`. Branch on `error` — don't wrap the call in `try/catch` expecting a throw.
- **Keep `maxAttempts` low.** One or two attempts catches the common "model wrapped the JSON in prose" and "model fat-fingered one field" cases. Beyond that you're usually fighting a prompt problem, and every attempt is a paid LLM trip.
- **Cost is visible per run.** `report.trips.length` tells you whether a repair fired; `usage.total` and `usage.cost` (when the model has a pricing table) let you alarm on extractions that needed retries.
- **Optional fields are the safety valve.** Marking `currentTitle` and similar fields `.optional()` lets the model legitimately omit data that isn't in the text, instead of being forced to hallucinate a value to satisfy the schema.
