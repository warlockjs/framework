import {
  InvalidRequestError,
  isProviderTool,
  safeJsonParse,
  type ModelCallOptions,
  type ModelResponse,
} from "@warlock.js/ai";

/** Only this documented builtin receives an adapter-supplied result.
 * Official wire shape and echo protocol (OpenAI SDK has no builtin_function variant):
 * https://platform.kimi.ai/docs/guide/use-web-search
 * The agent echoes arguments verbatim and continues within its normal maxTrips. */
export function moonshotSearchEnabled(
  provider: string,
  options: ModelCallOptions | undefined,
): boolean {
  if (provider !== "moonshot" && provider !== "kimi") return false;
  const definitions = [
    ...(options?.providerTools ?? []),
    ...(options?.tools ?? []).filter(isProviderTool),
  ];
  return definitions.some((entry) => {
    const fn = entry.definition.function;
    return (
      entry.provider === provider &&
      entry.definition.type === "builtin_function" &&
      typeof fn === "object" &&
      fn !== null &&
      "name" in fn &&
      fn.name === "$web_search"
    );
  });
}

export function moonshotSearchCall(
  id: string,
  name: string,
  argumentsText: string,
): NonNullable<ModelResponse["serverToolCalls"]>[number] {
  const invalid = Symbol("invalid");
  const input = safeJsonParse<unknown>(argumentsText, invalid);
  if (input === invalid) {
    throw new InvalidRequestError(
      "Kimi returned invalid JSON for $web_search; refusing to echo incomplete arguments.",
    );
  }
  return {
    id,
    name,
    input,
    result: argumentsText,
    providerMetadata: { moonshotArguments: argumentsText },
  };
}
