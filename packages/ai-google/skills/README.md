# `@warlock.js/ai-google` — skills index

Per-task skills. Cross-references name the topic ("the `<topic>` topic"), and for another package add its skill ("the `<topic>` topic of the `warlock-js-<pkg>` skill").

## Skills

### `setup-google`

Wire @warlock.js/ai-google — new GoogleSDK({apiKey} | {vertexai, project, location}) for Gemini API + Vertex AI. generateContent / embedContent + thoughtSignature round-trip for thinking models, batched embeddings. Load when wiring a Gemini-backed model into a @warlock.js agent or running on Vertex AI.
