# WR-003: Google Developer API token counting rejects agent prompts with tools

Date: 2026-10-18
Package: @warlock.js/ai-google 5.31.0, @warlock.js/ai 5.31.0
Observed in: Bureau B7 live acceptance, gemini-3.5-flash-lite, session de74fb9c-399a-426c-baf4-b113edde7dda

Bureau reserves its per-run USD budget before every trip with countInputTokens(model, messages, {tools}). Google Developer API models expose countTokens, but that method rejects any system instructions or tools before making a network call. countInputTokens prefers that method and propagates its rejection. Therefore every capped Google agent run with normal system instructions/workspace tools fails before inference. The live session reported zero tokens and zero spend.

Reproduction: GoogleSDK({apiKey: dummy}).model({name: 'gemini-3.5-flash-lite'}).countTokens([{role:'system',content:'test'},{role:'user',content:'hello'}], {tools:[...]}) rejects with InvalidRequestError explaining that the typed SDK count endpoint cannot count system instructions or tools. No real key is needed to reproduce this local rejection.

Requested: full-request Developer API counting via the native generateContentRequest count surface, or explicit capability metadata allowing callers to choose a conservative estimate rather than discovering this through a failed paid run.

Bureau stopgap: only its Google Developer API budget preflight uses estimateInputTokens with one character per token, all tool schemas, and a larger per-message allowance. This is an explicitly conservative reservation estimate, not an exact tokenizer; actual provider usage continues to settle the cap and price the displayed cost. Other providers keep native counting when supported. No framework files changed.
