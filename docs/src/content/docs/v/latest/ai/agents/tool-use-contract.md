---
title: "Tool-use contract"
description: Opt-in agent options that make a model act when asked, retry after a tool refusal, and run deterministic backstops around the turn, plus eval checks for the same failures.
sidebar:
  order: 7
  label: "Tool-use contract"
---

Two failures recur in tool-using agents. The user clearly asks for a change and the model offers it instead of making it ("Want me to swap that?"). Or a tool refuses a call (an id that is not in the library) and the model apologises and stops instead of trying a valid option. Three agent options handle these, and two eval checks catch them in tests. All of them are off by default: an agent without these options behaves exactly as before.

## `actWhenAsked`

When the user's input matches an intent and the model answers without calling a required tool, the agent sends one more turn with a hint instead of accepting the answer.

```ts
const coach = ai.agent({
  model,
  tools: [updatePlan],
  actWhenAsked: {
    intents: [/\b(swap|replace|change|add|remove)\b/i],
    requiredTools: ["update_plan"],
  },
});
```

| Field           | Meaning                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `intents`       | Any match makes the turn an action request. Each entry is a case-insensitive substring, a `RegExp`, or `(input) => boolean`.  |
| `requiredTools` | Tools that count as acting. A call that failed does not count.                                                                |
| `require`       | `"any"` (default) or `"all"` of `requiredTools`.                                                                              |
| `hint`          | The re-prompt text, or `({ input, reply, requiredTools, tripIndex }) => string`. Default: ask the model to call the tool now. |
| `maxReprompts`  | Re-prompts per run. Default `1`.                                                                                              |

The model's first answer stays in the history, followed by the hint as a user message. The re-prompt uses one of the run's `maxTrips`; with none left it does not happen. When streaming, the text of the first answer has already reached the client.

## `onToolRefusal`

```ts
ai.agent({ model, tools, onToolRefusal: "retry-once-with-hint" });
```

A call counts as a refusal when its input failed schema validation, or its result is an object with `refused: true` or `ok: false` and a `reason`, `error` or `message` string. If the model then answers without calling a tool again, the agent sends one retry prompt that quotes the reason. A later successful call of the same tool clears the refusal, so a model that corrects itself gets no extra prompt.

```ts
onToolRefusal: {
  retries: 2,                                                  // default 1
  hint: ({ tool, reason }) => `${tool} said: ${reason}. Pick a valid option.`,
  isRefusal: (call) => (call.output === "locked" ? "plan is locked" : false),
}
```

`"off"` or leaving it out keeps the current behaviour: the refusal is fed back to the model and nothing more happens.

## `backstops`

Deterministic server-side checks around the model turn, for things you will not leave to a prompt, such as capturing a reported injury.

```ts
ai.agent({
  model,
  backstops: [
    {
      name: "injury-capture",
      phase: "before", // default "after"
      detect: (turn) => /\b(hurt|injur|pain)\b/i.test(turn.input),
      run: async ({ input, state }) => {
        await saveInjury(input);
        return { prompt: "The user reported an injury. Acknowledge it first." };
      },
    },
  ],
});
```

- `"before"` runs once, before the first model call. A returned `prompt` is added to the conversation as a user message.
- `"after"` runs after each model answer that would end the run. It sees the `reply`, and a returned `prompt` re-prompts the model.
- `detect(turn)` receives `{ phase, runId, input, reply?, tripIndex, toolCalls, messages }`; `run(context)` receives the same plus `agent` and a `state` object shared by the run's backstops.
- Each backstop runs at most once per run, so a re-prompted answer does not repeat a side effect.
- An error in `detect` or `run` is logged and skipped; it never fails the run.

When several options fire on the same answer, backstops go first, then the refusal retry, then `actWhenAsked`; one re-prompt is sent per answer.

## Eval checks

```ts
const report = await coach.eval({
  cases: [{ name: "swap", input: "Swap squats for lunges" }],
  scorers: [
    ai.eval.requiredToolCalled({ tools: ["update_plan"], intents: [/\bswap\b/i] }),
    ai.eval.changeClaimedWithoutToolCall({ tools: ["update_plan"] }),
  ],
});
```

- `requiredToolCalled({ tools, intents?, require? })` fails with "required tool not called" when the case is an action request (input matches `intents`; every case when `intents` is omitted) and no required tool call succeeded.
- `changeClaimedWithoutToolCall({ tools?, claims? })` fails with "change claimed without a tool call" when the reply says something was changed ("I've swapped it", "has been updated") and no change tool completed. `claims` replaces the default patterns; without `tools`, any completed tool call backs the claim.

## Seeing what happened

Each re-prompt, refusal retry and backstop is logged and recorded in the [agent trace](/v/latest/ai/observability/agent-trace/) on the turn that triggered it.

## Related

- [Run an agent](/v/latest/ai/agents/run-agent/) — the trip loop these options extend.
- [Evaluation and datasets](/v/latest/ai/testing/evaluation-and-datasets/) — running scorers over cases.
