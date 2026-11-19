import {
  DEVTOOLS_AI_ERROR_CATEGORIES,
  type DevtoolsAiErrorCategory,
} from "../../production/contracts";
import type { DevtoolsAiErrorCounts } from "../types";

/** Labels the Errors page shows, by category. */
export const DEVTOOLS_AI_ERROR_LABELS: Readonly<Record<DevtoolsAiErrorCategory, string>> = {
  "rate-limit": "Rate limit",
  timeout: "Timeout",
  refusal: "Refusal",
  provider: "Provider error",
  budget: "Budget",
  tool: "Tool failed",
  schema: "Invalid output",
  incomplete: "Incomplete",
  other: "Other",
};

/** Error counts with every category at 0. */
export function emptyErrorCounts(): DevtoolsAiErrorCounts {
  const counts = {} as DevtoolsAiErrorCounts;

  for (const category of DEVTOOLS_AI_ERROR_CATEGORIES) counts[category] = 0;

  return counts;
}

const CODE_CATEGORIES: Readonly<Record<string, DevtoolsAiErrorCategory>> = {
  PROVIDER_RATE_LIMIT: "rate-limit",
  PROVIDER_QUOTA_EXCEEDED: "rate-limit",
  PROVIDER_OVERLOADED: "rate-limit",
  PROVIDER_TIMEOUT: "timeout",
  CONTENT_FILTER: "refusal",
  GUARDRAIL_VIOLATION: "refusal",
  PROVIDER_ERROR: "provider",
  PROVIDER_INVALID_REQUEST: "provider",
  PROVIDER_AUTH: "provider",
  CONTEXT_LENGTH_EXCEEDED: "provider",
  PROVIDER_EMBEDDING_VECTOR_COUNT_MISMATCH: "provider",
  BUDGET_EXCEEDED: "budget",
  TOOL_EXEC_FAILED: "tool",
  SCHEMA_VALIDATION_FAILED: "schema",
  AGENT_INCOMPLETE: "incomplete",
  AGENT_MAX_TRIPS: "incomplete",
  AgentIncompleteError: "incomplete",
};

/**
 * The category of a failed or stopped agent span, from its status and error
 * type (an `AIErrorCode` such as `PROVIDER_RATE_LIMIT`, or an error name):
 *
 * - `rate-limit`: PROVIDER_RATE_LIMIT, PROVIDER_QUOTA_EXCEEDED, PROVIDER_OVERLOADED
 * - `timeout`: PROVIDER_TIMEOUT, or a name/type containing "Timeout"
 * - `refusal`: CONTENT_FILTER, GUARDRAIL_VIOLATION
 * - `provider`: PROVIDER_ERROR, PROVIDER_INVALID_REQUEST, PROVIDER_AUTH,
 *   CONTEXT_LENGTH_EXCEEDED, PROVIDER_EMBEDDING_VECTOR_COUNT_MISMATCH
 * - `budget`: BUDGET_EXCEEDED
 * - `tool`: TOOL_EXEC_FAILED
 * - `schema`: SCHEMA_VALIDATION_FAILED
 * - `incomplete`: status `incomplete` or `max-iterations`, AGENT_INCOMPLETE,
 *   AGENT_MAX_TRIPS, AgentIncompleteError
 * - `other`: anything else
 */
export function classifyAiError(
  status: string,
  errorType: string | undefined,
): DevtoolsAiErrorCategory {
  if (status === "incomplete" || status === "max-iterations") return "incomplete";

  if (!errorType) return "other";

  const known = CODE_CATEGORIES[errorType];

  if (known) return known;

  return /timeout/i.test(errorType) ? "timeout" : "other";
}
