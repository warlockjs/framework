import { command } from "../../commands/cli-command";

/** Built in so installing AI does not require cli.commands registration. */
export const aiCommand = command({
  name: "ai <action> [runId]",
  description:
    "AI tooling: `measure` input tokens and cost per call, `tools` to lint tool schemas per provider with token cost, `trace` to inspect an agent run from the dev server",
  preload: {},
  options: [
    {
      text: "--model",
      description: "measure: model ID (OpenAI), or openai: / anthropic: / google: ID",
      type: "string",
    },
    {
      text: "--model-module",
      description: "measure: module exporting a model or resolveModel(id)",
      type: "string",
    },
    {
      text: "--tools",
      description: "measure, tools: module exporting a tools array (named tools or default)",
      type: "string",
    },
    { text: "--system", description: "measure: UTF-8 system prompt file", type: "string" },
    {
      text: "--skills",
      description: "measure: directory containing skill folders with SKILL.md files",
      type: "string",
    },
    {
      text: "--targets",
      description: "tools: comma-separated providers to check (openai-strict, anthropic, google)",
      type: "string",
    },
    {
      text: "--warn-above",
      description: "tools: flag a definition above this many estimated tokens (default 500)",
      type: "string",
    },
    {
      text: "--fail",
      description: "tools: exit 1 when a tool has an error-level finding",
      type: "boolean",
    },
    {
      text: "--diff",
      description: "trace: compare the run with this other run id (system prompt and tools)",
      type: "string",
    },
    {
      text: "--url",
      description: "trace: dev server origin (default: read from .warlock/dev-server.json)",
      type: "string",
    },
    {
      text: "--devtools-path",
      description: "trace: devtools mount path (default /__warlock)",
      type: "string",
    },
    { text: "--json", description: "Print one JSON report to stdout", type: "boolean" },
  ],
  action: async (data) => {
    const { aiCommandAction } = await import("./ai/ai-command.action");
    await aiCommandAction(data);
  },
});
