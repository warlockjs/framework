---
title: "Recipe — Review-panel supervisor"
description: Fan one submission out to several independent reviewer agents in parallel, then aggregate their verdicts into a single pass/revise decision with a code-callback intent — a self-consistency panel for content moderation, PR review, or grading.
---

The scenario: a user submits a piece of content — a support-macro draft, a generated marketing blurb, a code snippet — and you want more than one model's opinion before you ship it. A single reviewer is a single point of failure; a panel of independent reviewers, each judging the same submission without seeing the others' verdicts, catches far more. Then a deterministic aggregator turns the panel's verdicts into one decision: ship it, or send it back with the consolidated notes.

This recipe fans one reviewer agent out into three parallel branches with `ai.fanOut`, dispatches them all on iteration zero via a `route` callback, and aggregates their verdicts in a pure-code callback intent on iteration one — no extra LLM call to count votes.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

```bash
# .env
OPENAI_API_KEY=sk-...
```

## The reviewer

One reviewer agent, fanned out into N independent copies. Each copy runs the same prompt against the same submission but as a separate dispatch slot, so their verdicts are independent samples. The reviewer emits a structured verdict — approve/reject plus a one-line reason and a severity.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  },
});

const model = openai.model({ name: "gpt-4o-mini" });

const reviewerVerdict = v.object({
  approved: v.boolean(),
  reason: v.string(),
  severity: v.enum(["none", "minor", "blocking"]),
});

const reviewer = ai.agent({
  name: "reviewer",
  description: "Independently reviews a submission and returns an approve/reject verdict.",
  model,
  // Slightly raised temperature so the parallel copies don't collapse to
  // identical answers — independent samples are the entire point of a panel.
  modelOptions: { temperature: 0.7 },
  output: reviewerVerdict,
  systemPrompt: ai.systemPrompt()
    .persona("You are a strict but fair content reviewer.")
    .instruction("Judge ONLY the submission you are given. Do not assume other reviewers exist.")
    .instruction("Set `approved: false` and `severity: \"blocking\"` for policy violations, factual errors, or unsafe content.")
    .instruction("Use `severity: \"minor\"` for style nits that don't block shipping."),
});
```

## The aggregator

A callback intent — pure code, zero tokens. It reads the panel's verdicts off the previous iteration's snapshot (`ctx.iterations[0].result`), applies a majority rule with a hard blocking-veto override, and returns the consolidated decision as its state slice. We declare its `output` schema so only the decided keys merge into state.

```ts
import type { DispatchContext } from "@warlock.js/ai";

type PanelDecision = {
  decision: "approved" | "revise";
  approvals: number;
  total: number;
  notes: string[];
};

const aggregate = {
  description: "Tally the reviewer panel's verdicts into one decision.",
  run: (ctx: DispatchContext): PanelDecision => {
    // The fan-out branches all ran last iteration; their per-branch
    // outputs are keyed by intent name on that iteration's snapshot.
    const panel = ctx.iterations[0]?.result ?? {};

    const verdicts = Object.values(panel)
      .map((branch) => branch.output as { approved: boolean; reason: string; severity: string } | undefined)
      .filter((verdict): verdict is NonNullable<typeof verdict> => verdict !== undefined);

    const total = verdicts.length;
    const approvals = verdicts.filter((verdict) => verdict.approved).length;
    const hasBlocker = verdicts.some((verdict) => verdict.severity === "blocking");

    // Majority approves AND nobody raised a blocker → ship it.
    const decision = approvals * 2 > total && !hasBlocker ? "approved" : "revise";

    // Surface the dissenting / blocking reasons so the author knows what to fix.
    const notes = verdicts
      .filter((verdict) => !verdict.approved || verdict.severity === "blocking")
      .map((verdict) => verdict.reason);

    return { decision, approvals, total, notes };
  },
  output: v.object({
    decision: v.enum(["approved", "revise"]),
    approvals: v.number(),
    total: v.number(),
    notes: v.array(v.string()),
  }),
};
```

## The supervisor

`route` is deterministic here — there's nothing for an LLM router to decide. Iteration 0 fans out to all three reviewer branches in parallel (`Promise.all` under the hood); iteration 1 runs the aggregator; then `END`. `ai.fanOut(reviewer, 3)` generates the keys `reviewer1`, `reviewer2`, `reviewer3`.

```ts
import { END } from "@warlock.js/ai";

type PanelState = {
  decision?: "approved" | "revise";
  approvals?: number;
  total?: number;
  notes?: string[];
};

const reviewPanel = ai.supervisor<PanelState, PanelState>({
  name: "review-panel",
  goal: "Get three independent verdicts on the submission and decide whether to ship it.",
  intents: {
    ...ai.fanOut(reviewer, 3), // reviewer1, reviewer2, reviewer3
    aggregate,
  },
  route: (ctx) => {
    if (ctx.iteration === 0) {
      return ["reviewer1", "reviewer2", "reviewer3"];
    }

    if (ctx.iteration === 1) {
      return "aggregate";
    }

    return END;
  },
  output: v.object({
    decision: v.enum(["approved", "revise"]),
    approvals: v.number(),
    total: v.number(),
    notes: v.array(v.string()),
  }),
  maxIterations: 3,
});
```

## Run it

```ts
const submission =
  "Subject: Your account is suspended!! Click here within 24h to avoid permanent deletion.";

const { data, error, usage, report } = await reviewPanel.execute(submission);

if (error) {
  console.error(`panel failed (${error.code}), terminated by ${report.terminatedBy}`);
  return;
}

if (data?.decision === "approved") {
  console.log(`shipped — ${data.approvals}/${data.total} reviewers approved`);
} else {
  console.log(`needs revision (${data?.approvals}/${data?.total} approved):`);
  data?.notes.forEach((note) => console.log(`  - ${note}`));
}

// Per-branch forensics: each reviewer's verdict lives on iteration 0's snapshot.
const panelSnapshot = report.snapshots[0]?.result ?? {};
for (const [intent, branch] of Object.entries(panelSnapshot)) {
  const verdict = branch.output as { approved: boolean; severity: string };
  console.log(`${intent}: ${verdict.approved ? "approve" : "reject"} (${verdict.severity})`);
}

console.log(`${usage.total} tokens across the panel + aggregator`);
```

Expected flow for this (clearly abusive) submission:

1. **Iteration 0** — `route` returns `["reviewer1", "reviewer2", "reviewer3"]`. All three dispatch in parallel; each independently flags the phishing pattern and returns `{ approved: false, severity: "blocking" }`.
2. **Iteration 1** — `route` returns `"aggregate"`. The callback reads the three verdicts off `ctx.iterations[0].result`, sees a blocker, and returns `{ decision: "revise", approvals: 0, total: 3, notes: [...] }`.
3. **Iteration 2** — `route` returns `END`; the run terminates with `terminatedBy: "route"`, and `data` is the validated decision.

Three reviewer trips (parallel, so latency is one trip's worth) plus a zero-token aggregator.

## Production notes

- **Independence is the whole point — protect it.** Each fan-out branch must judge the submission cold. Raise `temperature` so the copies actually diverge, and keep the reviewer prompt from referencing "the other reviewers" (it can't see them anyway, but a prompt that implies a panel biases the sample). If every branch returns the same answer every time, you're paying 3× for one opinion.
- **Aggregate in code, not in an LLM.** Counting votes is deterministic — a callback intent does it for free and is trivially testable. Reach for an LLM aggregator only when the merge is genuinely judgmental (e.g. synthesizing conflicting prose), and even then prefer a `run` callback that calls one agent via `ctx.run(...)` over adding another routed intent.
- **Veto beats majority for safety.** A pure majority rule ships content two reviewers liked and one flagged as unsafe. The blocking-severity veto in this aggregator overrides the count — for moderation and code review, one credible blocker should outweigh a thin majority. Tune the rule to your risk tolerance.
- **Fan-out branches share the underlying agent instance.** `ai.fanOut` clones the agent across distinct intent *keys*, not the agent object — every branch references the same `reviewer`. That's intended (they're independent dispatch slots, not independent configs); if you need genuinely different reviewers, list them as separate named intents instead of fanning one out.
- **The panel's verdicts persist on the report.** Iteration 0's `snapshot.result` keeps every branch's `output`, `usage`, `duration`, and any per-branch `error` — a reviewer that errored doesn't abort its siblings, so always check `branch.error` before trusting a verdict when you tally.
