import { inferModelKind, type ModelInfo, type ModelKind } from "@warlock.js/ai";

/**
 * Map one entry of an OpenAI-style `GET /models` listing to {@link ModelInfo}.
 *
 * OpenAI's own entries carry `id`, `created` and `owned_by` only. The
 * compatible vendors add fields on top of that shape, and this reads the ones
 * that are documented: Groq `context_window` and `active`, Mistral `name`,
 * `description`, `max_context_length` and `capabilities`, and a `created_at`
 * date string. Returns `undefined` for an entry that should not be offered
 * (an id-less row, or one the vendor marks inactive).
 */
export function toModelInfo(entry: unknown, provider: string): ModelInfo | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }

  const row = entry as Record<string, unknown>;
  const id = row.id;

  if (typeof id !== "string" || id === "" || row.active === false) {
    return undefined;
  }

  const created = numberOf(row.created) ?? secondsOf(row.created_at);
  const contextWindow = numberOf(row.context_window) ?? numberOf(row.max_context_length);
  const maxOutputTokens = numberOf(row.max_completion_tokens);
  const label = typeof row.name === "string" && row.name !== "" ? row.name : id;

  return {
    id,
    label,
    provider,
    kind: kindOf(id, row.capabilities),
    ...(created !== undefined ? { created } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(typeof row.description === "string" && row.description !== ""
      ? { description: row.description }
      : {}),
  };
}

/** Mistral reports `capabilities.completion_chat`; everything else is classified by id. */
function kindOf(id: string, capabilities: unknown): ModelKind {
  const inferred = inferModelKind(id);

  if (typeof capabilities === "object" && capabilities !== null) {
    const flags = capabilities as Record<string, unknown>;

    if (flags.completion_chat === true) {
      return "chat";
    }

    if (flags.completion_chat === false && inferred === "chat") {
      return "other";
    }
  }

  return inferred;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function secondsOf(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const milliseconds = Date.parse(value);

  return Number.isNaN(milliseconds) ? undefined : Math.floor(milliseconds / 1000);
}
