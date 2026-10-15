import { describe, expect, it } from "vitest";
import type { Request, Response } from "../../../src/http";
import type { HttpContext, Middleware } from "../../../src/router/types";

/**
 * Compile-time contract of the v5 middleware calling convention — the same
 * single context object as `RequestHandler`. The `@ts-expect-error`
 * directives are the negative controls: if the positional shape ever
 * compiles again, the directive turns into a TS2578 "unused directive"
 * error and this file fails typecheck.
 */

const ctxMiddleware: Middleware = ({ request, response }) => {
  if (!request.path) {
    return response.badRequest({ error: "no path" });
  }

  return undefined;
};

const responseOnlyMiddleware: Middleware = ({ response }) => {
  return response.forbidden({ error: "denied" });
};

// @ts-expect-error — the v4 positional `(request, response)` middleware shape must NOT compile
const positionalMiddleware: Middleware = (request: Request, response: Response) => {
  return response.forbidden({ error: String(request.path) });
};

// Never executed — the bodies only exist so tsc checks the invocation shapes.
function positionalInvocation(request: Request, response: Response) {
  // @ts-expect-error — invoking middleware with two positional arguments must NOT compile
  return ctxMiddleware(request, response);
}

function ctxInvocation(context: HttpContext) {
  return ctxMiddleware(context);
}

describe("Middleware ctx signature", () => {
  it("keeps the ctx-shaped middleware and invocation shapes referenced", () => {
    expect(typeof ctxMiddleware).toBe("function");
    expect(typeof responseOnlyMiddleware).toBe("function");
    expect(typeof positionalMiddleware).toBe("function");
    expect(typeof positionalInvocation).toBe("function");
    expect(typeof ctxInvocation).toBe("function");
  });
});
