import { InvalidRequestError, type ModelCallOptions } from "@warlock.js/ai";

/** Adapter-only fields merged after the neutral request parameters. */
export type OllamaCallOptions = { body?: Record<string, unknown> };

const RESERVED_FIELDS = new Set(["model", "messages", "tools", "stream"]);

export function resolveProviderBody(
  options: ModelCallOptions | undefined,
): Record<string, unknown> {
  const provider = options?.providerOptions?.ollama as OllamaCallOptions | undefined;
  const body = provider?.body ?? {};
  const reserved = Object.keys(body).filter((key) => RESERVED_FIELDS.has(key));
  if (reserved.length > 0) {
    throw new InvalidRequestError(
      `providerOptions.ollama.body cannot set ${reserved.join(", ")}: use the call's messages, tools and model options.`,
      { context: { fields: reserved } },
    );
  }
  return body;
}
