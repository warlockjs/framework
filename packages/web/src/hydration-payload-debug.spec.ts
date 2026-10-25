import { stringify } from "devalue";
import { describe, expect, it } from "vitest";
import { PAYLOAD_SCRIPT_ID } from "./components/document-context";
import { readHydrationPayload } from "./hydration-payload";

function makeDocument(scriptTextContent: string): Document {
  return {
    getElementById(id: string) {
      if (id !== PAYLOAD_SCRIPT_ID) return null;

      return { textContent: scriptTextContent } as unknown as HTMLElement;
    },
  } as unknown as Document;
}

const payload = {
  appData: {},
  layoutData: {},
  pageData: {},
  shared: {},
  name: "staff",
  locale: "en",
  translations: {},
};

const debug = {
  name: "ForbiddenError",
  message: "Forbidden",
  phase: "middleware",
  routePath: "/staff",
  requestId: "req-1",
};

describe("readHydrationPayload: development error details", () => {
  it("accepts the `debug` details a development error page carries", () => {
    const errorPage = {
      error: { name: "ForbiddenError", message: "Forbidden" },
      status: 403,
      debug,
    };

    expect(readHydrationPayload(makeDocument(stringify({ ...payload, errorPage })))).toEqual({
      ...payload,
      errorPage,
    });
  });

  it("rejects `debug` that is not an object", () => {
    const errorPage = {
      error: { name: "ForbiddenError", message: "Forbidden" },
      status: 403,
      debug: "details",
    };

    expect(() => readHydrationPayload(makeDocument(stringify({ ...payload, errorPage })))).toThrow(
      /could not be read/,
    );
  });

  it("still rejects an unknown field beside `error` and `status`", () => {
    const errorPage = {
      error: { name: "ForbiddenError", message: "Forbidden" },
      status: 403,
      extra: true,
    };

    expect(() => readHydrationPayload(makeDocument(stringify({ ...payload, errorPage })))).toThrow(
      /could not be read/,
    );
  });
});
