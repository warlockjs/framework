import config from "@mongez/config";
import type { Request, Response } from "@warlock.js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../render-page", () => ({
  renderPageFailure: vi.fn(async () => ({
    html: "<html></html>",
    status: 500,
    headers: {},
    cookies: [],
    data: undefined,
    bundle: undefined,
  })),
}));

import { writePageFailureResponse } from "./write-page-failure-response";

function pair() {
  const headers: Record<string, string> = {};
  const response = {
    header: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    headers: vi.fn(),
    html: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    setContentType: vi.fn(),
  } as unknown as Response;
  const request = { path: "/orders", locale: "en", id: "req-1" } as unknown as Request;

  return { headers, request, response };
}

beforeEach(() => {
  config.set("app", { localeCodes: ["en", "ar"] });
});

afterEach(() => {
  config.set("app", {});
});

describe("writePageFailureResponse Vary", () => {
  it("lists the cookie, locale and declared headers for a route that opted into cache", async () => {
    const { headers, request, response } = pair();

    await writePageFailureResponse({
      name: "orders",
      request,
      response,
      thrown: new Error("boom"),
      cache: { varyHeaders: ["x-theme"] } as never,
      wantsData: false,
      applyBufferedCookie: vi.fn(),
    });

    expect(headers.Vary).toBe("x-warlock-data, Cookie, locale, x-theme");
  });

  it("sends no Vary for a plain HTML failure", async () => {
    const { headers, request, response } = pair();

    await writePageFailureResponse({
      name: "orders",
      request,
      response,
      thrown: new Error("boom"),
      wantsData: false,
      applyBufferedCookie: vi.fn(),
    });

    expect(headers.Vary).toBeUndefined();
  });
});
