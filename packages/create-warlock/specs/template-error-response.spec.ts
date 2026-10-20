import { describe, expect, it } from "vitest";
import { formatHttpErrorResponse } from "../templates/warlock/src/app/shared/utils/format-http-error-response";

describe("starter error response contract", () => {
  it("maps the framework's validation body into details without losing field errors", () => {
    const errors = [{ input: "email", error: "A valid email is required." }];

    expect(
      formatHttpErrorResponse({ status: 422, body: { errors }, requestId: "request-1" }),
    ).toEqual({
      error: { code: "validationFailed", message: "Request failed." },
      details: errors,
      requestId: "request-1",
    });
  });

  it.each([404, 429])("normalizes a framework %i response", (status) => {
    const result = formatHttpErrorResponse({
      status,
      body: { statusCode: status, error: "Framework error", message: "Public message" },
      requestId: "request-2",
    });

    expect(result).toEqual({
      error: { code: status === 404 ? "notFound" : "tooManyRequests", message: "Public message" },
      requestId: "request-2",
    });
  });

  it("keeps explicit app error codes and removes development stacks", () => {
    expect(
      formatHttpErrorResponse({
        status: 409,
        body: {
          error: { code: "orderCancelled", message: "Order already cancelled." },
          stack: "private",
        },
        requestId: "request-3",
      }),
    ).toEqual({
      error: { code: "orderCancelled", message: "Order already cancelled." },
      requestId: "request-3",
    });
  });

  it("masks every 5xx message and drops diagnostic payloads", () => {
    for (const status of [500, 502, 503]) {
      expect(
        formatHttpErrorResponse({
          status,
          body: { error: "secret", payload: { token: "secret" }, stack: "private" },
          requestId: "request-4",
        }),
      ).toEqual({
        error: { code: "serverError", message: "Internal server error." },
        requestId: "request-4",
      });
    }
  });
});
