---
description: 'Provider-neutral AI agents, tools, workflows, memory, RAG and multimodal calls. Exports `ai`, `humanApproval`, `guardrail`, `team`, `MockModel` and `countInputTokens`. Use for "run an agent", "define a tool", "stream a response", "add approval" or "track token cost". Not this package → @warlock.js/ai-tools for MCP and web tools; @warlock.js/ai-workspace for file/shell tools; @warlock.js/ai-openai for provider setup.'
---

# @warlock.js/ai

The core AI package. Everything hangs off the `ai` facade (`ai.agent`, `ai.tool`, `ai.team`, `ai.rag`, ...) and the same factories are exported standalone. An agent is one model plus a system prompt plus tools; the other runners compose agents. Model access comes from a provider package (`@warlock.js/ai-openai`, `@warlock.js/ai-anthropic`, ...), never from this one. Sibling packages (`@warlock.js/ai-tools`, `@warlock.js/ai-workspace`, `@warlock.js/ai-panoptic`) attach themselves onto `ai` on import.

## The 80% path

1. Read `ai-basics.md`, configure a provider (`pick-ai-provider.md`), and write a prompt (`write-system-prompt.md`).
2. Build an agent (`run-ai-agent.md`); give it typed tools (`define-ai-tool.md`).
3. Compose when one agent is not enough: `run-ai-workflow.md` (fixed steps), `run-supervisor.md` (routing), `run-ai-team.md`, `run-planner.md`.
4. Add safety: `guard-input-output.md`, `approve-tool-calls.md`, `secure-outbound-requests.md`, `handle-ai-errors.md`.
5. Make it durable and observable: `keep-agent-conversations.md` (stored chat), `run-orchestrator.md`, `durable-agent-runs.md`, `observe-ai-flows.md`.
6. Test it: `record-replay-llm.md`, `eval-datasets-and-ci.md`.

## Topics by area

- **Foundations and agents:** ai-basics, pick-ai-provider, run-ai-agent, write-system-prompt, refine-prompts, manage-prompts, attach-ai-middleware, ai-dx-helpers
- **Tools:** define-ai-tool
- **Composition:** run-ai-workflow, run-supervisor, run-ai-team, run-planner, run-orchestrator
- **Knowledge and memory:** run-ai-rag, rag-loaders-and-stores, embed-text, use-ai-memory, use-runtime-skills
- **Safety and human control:** guard-input-output, detect-and-redact-pii, escalate-block-to-human, approve-tool-calls, durable-resume, secure-outbound-requests, handle-ai-errors
- **Durability and storage:** keep-agent-conversations, durable-agent-runs, manage-ai-stores, persist-ai-data
- **Modalities:** generate-images, generate-speech, transcribe-audio
- **Observability and testing:** observe-ai-flows, log-ai-calls, record-replay-llm, eval-datasets-and-ci

## Conventions and pitfalls

- `@warlock.js/ai-tools`, `@warlock.js/ai-workspace`, `@warlock.js/ai-panoptic` extend `ai` by side-effect import; import the package once before using `ai.tools.*`, `ai.mcp`, `ai.workspace`.
- Errors all extend `AIError`; branch on the typed subclass, not the message.
- Persistence goes through `@warlock.js/cache`; checkpoints and snapshots are different stores.
- Human approval and durable resume need a persistent interrupt store when approval happens in another process.
- `registerAiMatchers` lazy-loads `vitest`; only call it from tests.
