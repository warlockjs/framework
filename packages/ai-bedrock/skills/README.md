# `@warlock.js/ai-bedrock` — skills index

Per-task skills. Cross-references name the topic ("the `<topic>` topic"), and for another package add its skill ("the `<topic>` topic of the `warlock-js-<pkg>` skill").

## Skills

### `setup-bedrock`

Wire @warlock.js/ai-bedrock — new BedrockSDK({region, credentials?, provider?}) for AWS Bedrock Converse API + Titan embeddings. AWS credential chain (no apiKey). Load when wiring a Bedrock-hosted model (Claude / Nova / Llama / Mistral / Cohere) into a @warlock.js agent.
