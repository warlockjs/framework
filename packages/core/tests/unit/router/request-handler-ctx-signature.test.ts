import { describe, expect, it } from "vitest";
import type { Request, Response } from "../../../src/http";
import type { HttpContext, RequestHandler } from "../../../src/router/types";

/**
 * Compile-time contract of the v5 handler calling convention: a handler
 * receives ONE context object (`{ request, response }`), never the v4
 * positional pair. The `@ts-expect-error` directives are the negative
 * controls — if the positional shape ever compiles again, the directive
 * turns into a TS2578 "unused directive" error and this file fails typecheck.
 */

const ctxHandler: RequestHandler = async ({ request, response }) => {
  return response.success({ path: request.path });
};

const requestOnlyHandler: RequestHandler = async ({ request }) => {
  return { path: request.path };
};

// @ts-expect-error — the v4 positional `(request, response)` shape must NOT compile
const positionalHandler: RequestHandler = (request: Request, response: Response) => {
  return response.success({ path: request.path });
};

// Never executed — the bodies only exist so tsc checks the invocation shapes.
function positionalInvocation(request: Request, response: Response) {
  // @ts-expect-error — invoking a handler with two positional arguments must NOT compile
  return ctxHandler(request, response);
}

function ctxInvocation(context: HttpContext) {
  return ctxHandler(context);
}

describe("RequestHandler ctx signature", () => {
  it("keeps the ctx-shaped handlers and invocation shapes referenced", () => {
    expect(typeof ctxHandler).toBe("function");
    expect(typeof requestOnlyHandler).toBe("function");
    expect(typeof positionalHandler).toBe("function");
    expect(typeof positionalInvocation).toBe("function");
    expect(typeof ctxInvocation).toBe("function");
  });
});
