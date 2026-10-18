import { command } from "../../commands/cli-command";

/** Built in so installing AI does not require cli.commands registration. */
export const aiCommand = command({
  name: "ai <action>",
  description: "Measure AI input tokens and uncached input USD per call",
  preload: {},
  options: [
    {
      text: "--model",
      description: "Model ID (OpenAI), or openai: / anthropic: / google: ID",
      type: "string",
      required: true,
    },
    {
      text: "--model-module",
      description: "Module exporting a model or resolveModel(id)",
      type: "string",
    },
    {
      text: "--tools",
      description: "Module exporting a tools array (named tools or default)",
      type: "string",
    },
    { text: "--system", description: "UTF-8 system prompt file", type: "string" },
    {
      text: "--skills",
      description: "Directory containing skill folders with SKILL.md files",
      type: "string",
    },
    { text: "--json", description: "Print one JSON report to stdout", type: "boolean" },
  ],
  action: async (data) => {
    const { aiCommandAction } = await import("./ai/ai-command.action");
    await aiCommandAction(data);
  },
});
