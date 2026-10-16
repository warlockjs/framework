import { stringify } from "devalue";
import { BadRequestError, ForbiddenError, setEnvironment } from "@warlock.js/core";
import { afterEach, describe, expect, it } from "vitest";
import { PAYLOAD_SCRIPT_ID } from "./components/document-context";
import { isHydrationPayload, readHydrationPayload } from "./hydration-payload";
import { hydrationErrorPageProps } from "./server/error-page";
import { PageValidationFailedError } from "./server/page-validation-failed-error";

/**
 * FW-01: the server renders 4xx error pages (a thrown `HttpError` below 500,
 * a failed page validation) with their real status, so the client gate must
 * accept every error page the server can produce. Each case builds the
 * payload with the real producer, `hydrationErrorPageProps`, and reads it
 * back through the real gate.
 */

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

const basePayload = {
  appData: {},
  layoutData: {},
  pageData: undefined,
  shared: {},
  name: "members.list",
  locale: "en",
  translations: {},
};

function documentWith(payload: unknown): Document {
  const text = stringify(payload);

  return {
    getElementById(id: string) {
      return id === PAYLOAD_SCRIPT_ID ? ({ textContent: text } as unknown as HTMLElement) : null;
    },
  } as unknown as Document;
}

function payloadFor(error: unknown, status: number) {
  return { ...basePayload, errorPage: hydrationErrorPageProps({ error, status }, error, "req-1") };
}

describe.each(["development", "production"] as const)("error page hydration in %s", (env) => {
  it("accepts a 403 from a thrown ForbiddenError", () => {
    setEnvironment(env);
    const payload = payloadFor(new ForbiddenError("Not allowed"), 403);

    expect(isHydrationPayload(payload)).toBe(true);
    expect(readHydrationPayload(documentWith(payload)).errorPage?.status).toBe(403);
  });

  it("accepts a 400 from a thrown BadRequestError", () => {
    setEnvironment(env);
    const payload = payloadFor(new BadRequestError("Bad query"), 400);

    expect(isHydrationPayload(payload)).toBe(true);
  });

  it("accepts a 400 from a failed page validation, with its sanitized issues", () => {
    setEnvironment(env);
    const error = new PageValidationFailedError([
      { input: "code", type: "maxLength", error: "Too long", value: "x".repeat(201) },
    ]);
    const payload = payloadFor(error, 400);

    expect(isHydrationPayload(payload)).toBe(true);
    expect(readHydrationPayload(documentWith(payload)).errorPage?.error).toMatchObject({
      errors: [{ input: "code", type: "maxLength", error: "Too long" }],
    });
  });

  it("accepts a 500 from an unexpected error (production adds an errorCode)", () => {
    setEnvironment(env);
    const payload = payloadFor(new Error("db down"), 500);

    expect(isHydrationPayload(payload)).toBe(true);
    if (env === "production") {
      expect(readHydrationPayload(documentWith(payload)).errorPage?.error).toMatchObject({
        errorCode: "req-1",
      });
    }
  });
});
