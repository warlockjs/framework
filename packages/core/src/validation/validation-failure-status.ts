import config from "@mongez/config";

/**
 * The status of a failed schema validation: `validation.response.status`, or
 * 422 when it is not configured.
 */
export function validationFailureStatus(): number {
  const status: unknown = config.get("validation.response.status");

  return typeof status === "number" && Number.isInteger(status) ? status : 422;
}
