import { describeStatus } from "./response-schemas";
import type { SchemaRegistry } from "./schema-registry";
import type { OpenApiResponse, OpenApiValidationResponseConfig } from "./types";

const DEFAULT_VALIDATION_RESPONSE = {
  errors: "errors",
  inputKey: "input",
  inputError: "error",
  status: 422,
};

export type ValidationResponseShape = typeof DEFAULT_VALIDATION_RESPONSE;

/**
 * The `validation.response` config over its documented defaults, as `Response.failedSchema`
 * reads it.
 */
export function resolveValidationResponse(
  config: OpenApiValidationResponseConfig | undefined,
): ValidationResponseShape {
  const merged = { ...DEFAULT_VALIDATION_RESPONSE };

  if (typeof config?.errors === "string" && config.errors) {
    merged.errors = config.errors;
  }

  if (typeof config?.inputKey === "string" && config.inputKey) {
    merged.inputKey = config.inputKey;
  }

  if (typeof config?.inputError === "string" && config.inputError) {
    merged.inputError = config.inputError;
  }

  if (typeof config?.status === "number" && Number.isInteger(config.status)) {
    merged.status = config.status;
  }

  return merged;
}

/**
 * The failed-validation response: `{ [errors]: [{ [inputKey]: string, [inputError]: string }] }`
 * under the configured status. The body is a shared component, emitted once.
 */
export function buildValidationFailedResponse(
  shape: ValidationResponseShape,
  registry: SchemaRegistry,
): { status: string; response: OpenApiResponse } {
  const ref = registry.shared("ValidationFailed", {
    type: "object",
    properties: {
      [shape.errors]: {
        type: "array",
        items: {
          type: "object",
          properties: {
            [shape.inputKey]: { type: "string" },
            [shape.inputError]: { type: "string" },
          },
          required: [shape.inputKey, shape.inputError],
        },
      },
    },
    required: [shape.errors],
  });

  return {
    status: String(shape.status),
    response: {
      description: describeStatus("422"),
      content: { "application/json": { schema: ref } },
    },
  };
}

/**
 * The 401 response of a guarded route: the conventional `{ error: string }` body.
 */
export function buildUnauthorizedResponse(registry: SchemaRegistry): OpenApiResponse {
  const ref = registry.shared("Unauthorized", {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
  });

  return {
    description: describeStatus("401"),
    content: { "application/json": { schema: ref } },
  };
}
