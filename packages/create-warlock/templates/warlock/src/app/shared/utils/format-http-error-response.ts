import type { HttpErrorResponseContext } from "@warlock.js/core";

const statusCodes: Record<number, string> = {
  400: "badRequest",
  401: "unauthorized",
  403: "forbidden",
  404: "notFound",
  409: "conflict",
  422: "validationFailed",
  429: "tooManyRequests",
};

/** Convert framework JSON errors to the project's public error contract. */
export function formatHttpErrorResponse({ status, body, requestId }: HttpErrorResponseContext) {
  const source = isRecord(body) ? body : {};
  const error = isRecord(source.error) ? source.error : {};
  const serverFault = status >= 500;
  const code = serverFault
    ? "serverError"
    : (text(error.code) ?? text(source.errorCode) ?? statusCodes[status] ?? "requestFailed");
  const message = serverFault
    ? "Internal server error."
    : (text(error.message) ?? text(source.message) ?? text(source.error) ?? "Request failed.");
  // Only deliberately public details belong here. Never include a 5xx payload
  // or the development-only stack attached by the framework error funnel.
  const details = serverFault ? undefined : (source.details ?? source.errors ?? source.payload);

  return {
    error: { code, message },
    ...(details === undefined ? {} : { details }),
    requestId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
