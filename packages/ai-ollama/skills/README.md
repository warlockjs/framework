# `@warlock.js/ai-ollama` — skills index

Per-task skills. Cross-references name the topic ("the `<topic>` topic"), and for another package add its skill ("the `<topic>` topic of the `warlock-js-<pkg>` skill").

## Skills

### `setup-ollama`

Wire @warlock.js/ai-ollama — new OllamaSDK({host?, headers?}) for local / self-hosted Ollama via the official ollama client (not OpenAI-compat). chat + embed, daemon-down error handling. Load when wiring a local or self-hosted Ollama model into a @warlock.js agent.
