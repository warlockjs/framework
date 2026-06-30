---
title: "Guardrails"
description: ai.guardrail composes input/output/tool-arg content detectors (pii, topic, injection, moderation) onto an agent — allow/redact/block/flag verdicts with an onBlock escalation seam.
sidebar:
  order: 11
  label: "Guardrails"
---

`ai.guardrail(options)` is one composed `AgentMiddleware` that runs content detectors at three points of an agent's loop — the outbound **prompt**, the model's **output**, and the **arguments** of a tool call — and maps each detector's verdict onto the pipeline's throw / rewrite / record mechanics. It ships with three zero-dependency detectors (`pii`, `topic`, `injection`) and one optional moderation detector backed by a lazy `openai` peer.

## When to reach for it

- **PII hygiene** — redact SSNs / emails / cards out of model replies before they reach a user or a log.
- **Stay on topic** — block (or flag) replies that drift into a denied subject.
- **Prompt-injection defense** — reject jailbreak / override / exfiltration markers on the inbound prompt.
- **Tool-arg safety** — block a tool call whose arguments carry something they shouldn't.
- **Human review** — escalate a hard block to a review queue via `escalation.onBlock`.

It is agent middleware, so it composes with everything else (budget, semantic cache, [human approval](./human-in-the-loop)). See [Attach middleware](./attach-middleware).

## The three phases

| Phase | Hook | Inspects | Supported verdicts |
| --- | --- | --- | --- |
| `input` | `trip.before` | the outbound user prompt | `allow` / `block` / `flag` (**`redact` → `block`**) |
| `output` | `trip.after` | `response.content` | `allow` / `redact` / `block` / `flag` (full) |
| `tool` | `tool.before` | `JSON.stringify(toolArgs)` | `allow` / `block` / `flag` (**`redact` → `block`**) |

Each phase is an **array of detectors run in registration order**; the first non-`allow`/non-`flag` verdict short-circuits that phase.

## `ai.guardrail(options)`

```ts
import { ai } from "@warlock.js/ai";

const policy = ai.guardrail({
  name: "compliance",                                       // default "guardrail"
  input: [ai.guardrail.injection({ onMatch: "block" })],
  output: [ai.guardrail.pii({ onMatch: "redact", mask: "[REDACTED:{label}]" })],
  tool: [ai.guardrail.pii({ onMatch: "block" })],
  toolNames: ["send_email"],                                // scope the tool detectors
  escalation: {
    async onBlock(event) { await reviewQueue.enqueue(event); },
  },
});

const agent = ai.agent({ model, tools: [sendEmail], middleware: [policy] });
```

### Options

```ts
interface GuardOptions {
  name?: string;                            // surfaces on the error + the ctx.state namespace
  input?: readonly GuardrailDetector[];     // run at trip.before over the prompt
  output?: readonly GuardrailDetector[];    // run at trip.after over response.content
  tool?: readonly GuardrailDetector[];      // run at tool.before over JSON.stringify(args)
  toolNames?: string | readonly string[];   // restrict the tool detectors to these tools
  escalation?: GuardrailEscalation;         // onBlock hook for escalate:true verdicts
}
```

`toolNames` scopes only the `tool` hooks (via the core `forTool` helper); `input` / `output` detectors still fire on every trip regardless. A guard with no detectors is a harmless no-op.

## Verdicts — `allow` / `redact` / `block` / `flag`

Every detector's `check()` returns one `GuardrailVerdict`:

- **`allow`** — clean; continue to the next detector.
- **`redact`** — the detector returns rewritten `text`; the phase substitutes it (output only — see the degrade rule below).
- **`block`** — reject the trip / tool call. The guard throws a `GuardrailViolationError` onto `result.error`.
- **`flag`** — allow the content but record the match into `ctx.state` under `<name>.flags` for a downstream observer (panoptic, your code). The fold continues.

```ts
type GuardrailVerdict =
  | { type: "allow" }
  | { type: "redact"; text: string; reason: string; matches: readonly GuardrailMatch[] }
  | { type: "block"; reason: string; matches?: readonly GuardrailMatch[]; escalate?: boolean }
  | { type: "flag"; reason: string; matches: readonly GuardrailMatch[] };
```

### Input redaction degrades to block

The core `trip.before` seam can only **short-circuit or throw** — it has no rewrite-and-continue path. So a `redact` verdict on the **input** phase is downgraded to a `block` rather than silently passing the un-redacted prompt through. The same applies to the **tool** phase (`tool-arg-redaction-unsupported`): silently rewriting tool arguments would change the call's side-effects unpredictably, so a tool `redact` becomes a `block`. Only the **output** phase honours `redact` (it can return a replacement `ModelResponse`).

Practically: use `redact` for output PII; use `block` / `flag` for input and tool detectors.

### Fail-open on detector fault

A detector's `check()` *throwing* is an infrastructure fault (e.g. a moderation API outage), not a content violation. The guard records it as a `flag` (`<detector>.error`) and continues — one detector's outage never aborts every agent run.

## Built-in detectors

All four attach as methods on `ai.guardrail`, so the whole vocabulary lives under one name. The first three are zero-runtime-dependency (pure string / regex).

### `ai.guardrail.pii(options?)`

Scans for personally identifiable information via curated linear regexes (safe against catastrophic backtracking) plus an optional exact-string dictionary.

```ts
ai.guardrail.pii({
  detect: ["ssn", "credit-card"],   // default: all categories
  onMatch: "redact",                 // default "redact"
  mask: "[PII:{label}]",             // {label} → the matched category; default "[REDACTED]"
  dictionary: ["Project Aurora"],    // extra exact terms, matched case-insensitively
});
```

Categories: `ssn`, `email`, `phone`, `credit-card`, `ipv4`. `onMatch` is one of `redact` (default) / `block` / `flag`. Overlapping spans are deduped (earliest, widest kept) so a span is never masked twice.

### `ai.guardrail.topic(options)`

Gates text against a deny list, an allow list, or both. A `string` matches case-insensitively as a substring; a `RegExp` is tested as-is.

```ts
// Block denied subjects:
ai.guardrail.topic({ deny: ["medical advice", /diagnos\w+/i] });

// Stay on-topic: anything matching NONE of the allow terms is flagged:
ai.guardrail.topic({ allow: ["billing", "invoice", "refund"], onMatch: "flag" });
```

The deny list is checked first; the first hit decides. `onMatch` is `block` (default) or `flag` — topic never redacts (it can't meaningfully rewrite a whole-text policy miss). `reason` overrides the verdict message.

### `ai.guardrail.injection(options?)`

Matches a curated set of jailbreak / prompt-injection marker phrases — override (`"ignore previous instructions"`), role-reset (`"you are now"`), jailbreak (`"developer mode"`, `"do anything now"`), exfiltration (`"reveal your system prompt"`) — extensible with caller `markers`.

```ts
const guard = ai.guardrail({
  input: [ai.guardrail.injection({ onMatch: "block" })], // reject on the inbound prompt
  output: [ai.guardrail.injection()],                    // flag-only on the model's reply
});

// Extend the built-in set with a house rule:
ai.guardrail.injection({ markers: [/system\s*:\s*override/i, "sudo mode"] });
```

`onMatch` defaults to `"flag"` — callers commonly escalate to `"block"` on the `input` phase. Phrases are deliberately specific so ordinary prose does not trip the rule.

### `ai.guardrail.moderation(options?)` — optional `openai` peer

Sends the inspected text to OpenAI's moderation endpoint and maps flagged categories to a verdict: any category in `blockOn` → `block`; any other flagged category → `flag`; nothing flagged → `allow`.

```ts
ai.guardrail.moderation({
  blockOn: ["violence", "sexual/minors"], // omit to flag on any category
  model: "omni-moderation-latest",        // default
  apiKey: process.env.OPENAI_API_KEY,     // reads OPENAI_API_KEY when omitted
});

// Bring your own client (or a test double) — the SDK is then never imported:
ai.guardrail.moderation({ client: openAiClient });
```

The `openai` SDK is an **optional peer**, resolved lazily on the first `check()` — importing `@warlock.js/ai` never forces it to install. When it's absent and no `client` was supplied, a curated install string surfaces on the first call. Because `check()` is async, the moderation detector adds a network round-trip per inspected text — reserve it for the phases that need it.

### Custom detectors

A detector is just `{ name, check(text, ctx) }`:

```ts
const noShouting = {
  name: "no-shouting",
  check(text) {
    return text === text.toUpperCase() && text.length > 0
      ? { type: "flag", reason: "all caps", matches: [{ rule: "no-shouting" }] }
      : { type: "allow" };
  },
};

ai.guardrail({ output: [noShouting] });
```

`check` receives a read-only `GuardrailDetectorContext` (`phase` plus the live trip `ctx`) and may be sync or async. A detector must never mutate `ctx` — the factory owns all pipeline effects.

## Blocks, errors, and escalation

A `block` verdict throws a `GuardrailViolationError` onto `result.error` — like every `AIError`, it never escapes `execute()`:

```ts
import { GuardrailViolationError } from "@warlock.js/ai";

const result = await agent.execute(userText);

if (result.error instanceof GuardrailViolationError) {
  // result.error.phase    — "input" | "output" (widened with "tool" at runtime)
  // result.error.reason    — the detector's reason
  // result.error.guardrail — the guard's `name`
}
```

### `escalation.onBlock` — hand a block to a human

A detector can return `{ type: "block", escalate: true }`. When it does, the guard **awaits** `escalation.onBlock(event)` *before* throwing — the seam for routing a hard block to a human-review surface:

```ts
ai.guardrail({
  output: [ai.guardrail.topic({ deny: ["legal advice"] /* a detector may set escalate */ })],
  escalation: {
    async onBlock(event) {
      // event: { phase, reason, matches?, ctx }
      await reviewQueue.enqueue({ phase: event.phase, reason: event.reason });
    },
  },
});
```

`onBlock` is a plain callback by design — the guard takes no dependency on the human-step machinery. To turn a guard block into a true pause-and-resume, wire your own review queue here and pair it with [`ai.human.resume`](./human-in-the-loop). The callback fires **only** for `escalate: true` verdicts.

## Reading `flag` annotations

`flag` verdicts don't stop the run — they accumulate into `ctx.state` under `<name>.flags` as an append-only `FlagRecord[]`:

```ts
interface FlagRecord {
  detector: string;       // which detector flagged
  phase: GuardrailPhase;  // "input" | "output" | "tool"
  reason: string;
  matches: readonly GuardrailMatch[];
}
```

This is how you run a guard in **observe-only** mode — set every detector to `onMatch: "flag"`, let runs complete, and inspect the recorded flags to tune thresholds before flipping any detector to `block`.

## Related

- [Attach middleware](./attach-middleware) — how the guard composes with budget, cache, approval; ordering invariants.
- [Human in the loop](./human-in-the-loop) — pair `escalation.onBlock` with `ai.human.resume` for a true human gate.
- [Run agent](../the-basics/run-agent) — the agent the guard wraps; `result.error` handling.
- [Define tools](../the-basics/define-tools) — the tools `tool` detectors inspect.
