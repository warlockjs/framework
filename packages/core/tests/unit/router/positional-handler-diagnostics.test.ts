import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPositionalHandlerSuspects,
  describePositionalHandlerSuspect,
  inspectHandlerSignature,
  listPositionalHandlerSuspects,
  looksLikePositionalHandler,
  reportPositionalHandlerSuspects,
} from "../../../src/router/positional-handler-diagnostics";
import { Router } from "../../../src/router/router";

/**
 * The diagnostic is a WARNING path: it must flag the v4 positional shape
 * loudly, never flag the v5 context shape, and never throw. These tests pin all
 * three, plus the boot-time "one list, once" reporting behaviour.
 */

const router = Router.getInstance();

let sourceFile = "";
let counter = 0;

beforeEach(() => {
  sourceFile = `positional-handler-source-${counter++}`;
  clearPositionalHandlerSuspects();
});

afterEach(() => {
  router.removeRoutesBySourceFile(sourceFile);
  clearPositionalHandlerSuspects();
});

describe("looksLikePositionalHandler — v5 shapes must not warn", () => {
  it("does not flag the destructured context form", () => {
    expect(looksLikePositionalHandler(({ request, response }: any) => [request, response])).toBe(
      false,
    );
  });

  it("does not flag an async destructured context form", () => {
    expect(
      looksLikePositionalHandler(async ({ request, response }: any) => [request, response]),
    ).toBe(false);
  });

  it("does not flag a single named context parameter", () => {
    expect(looksLikePositionalHandler((ctx: any) => ctx)).toBe(false);
  });

  it("does not flag a parenthesis-free single-parameter arrow", () => {
    // Built through `Function` because a TypeScript-annotated parameter always
    // emits parentheses, and the paren-free `ctx => …` form is its own branch.
    const handler = new Function("return ctx => ctx")();

    expect(Function.prototype.toString.call(handler)).toBe("ctx => ctx");
    expect(looksLikePositionalHandler(handler)).toBe(false);
  });

  it("does not flag a partially destructured context", () => {
    expect(looksLikePositionalHandler(({ request }: any) => request)).toBe(false);
  });

  it("does not flag a zero-parameter handler", () => {
    expect(looksLikePositionalHandler(() => undefined)).toBe(false);
  });

  it("does not flag a rest-parameter handler", () => {
    expect(looksLikePositionalHandler((...args: any[]) => args)).toBe(false);
  });

  it("does not flag a destructured first parameter followed by another", () => {
    // Arity alone would wrongly flag this; reading the source does not.
    expect(looksLikePositionalHandler(({ request }: any, extra: any) => [request, extra])).toBe(
      false,
    );
  });

  it("does not flag a destructured context whose defaults contain commas", () => {
    expect(
      looksLikePositionalHandler(({ request, response }: any = { request: 1, response: 2 }) => [
        request,
        response,
      ]),
    ).toBe(false);
  });

  it("does not flag a non-function", () => {
    expect(looksLikePositionalHandler(undefined)).toBe(false);
    expect(looksLikePositionalHandler({ request: 1, response: 2 })).toBe(false);
  });
});

describe("looksLikePositionalHandler — v4 shapes must warn", () => {
  it("flags the two-argument positional arrow", () => {
    expect(looksLikePositionalHandler((request: any, response: any) => [request, response])).toBe(
      true,
    );
  });

  it("flags a two-argument function declaration", () => {
    function homePageController(request: any, response: any) {
      return [request, response];
    }

    expect(looksLikePositionalHandler(homePageController)).toBe(true);
  });

  it("flags a two-argument async function", () => {
    expect(
      looksLikePositionalHandler(async function (request: any, response: any) {
        return [request, response];
      }),
    ).toBe(true);
  });

  it("flags the defaulted second parameter that arity alone misses", () => {
    const handler = (request: any, response: any = null) => [request, response];

    // Function.length stops at the first default, so arity reports 1 here.
    expect(handler.length).toBe(1);
    expect(looksLikePositionalHandler(handler)).toBe(true);
  });

  it("flags a bound positional handler via the arity fallback", () => {
    // `bind` replaces the source with `[native code]`, so only arity survives.
    const controller = {
      show(request: any, response: any) {
        return [request, response];
      },
    };

    const bound = controller.show.bind(controller);

    expect(Function.prototype.toString.call(bound)).toContain("[native code]");
    expect(looksLikePositionalHandler(bound)).toBe(true);
  });

  it("does not flag a bound context handler", () => {
    const controller = {
      list({ request }: any) {
        return request;
      },
    };

    expect(looksLikePositionalHandler(controller.list.bind(controller))).toBe(false);
  });
});

describe("describePositionalHandlerSuspect", () => {
  it("names the handler, the route and the exact fix", () => {
    const message = describePositionalHandlerSuspect({
      method: "GET",
      path: "/",
      handlerName: "homePageController",
      sourceFile: "src/app/home/routes.ts",
    });

    expect(message).toBe(
      'Handler "homePageController" (GET /) looks like the v4 positional signature ' +
        "(request, response). v5 passes a single context object — change it to " +
        "({ request, response }).",
    );
  });
});

describe("registration-time collection", () => {
  it("records a v4 handler and skips a v5 one", async () => {
    await router.withSourceFile(sourceFile, () => {
      router.get("/positional-diag-v4", ((request: any, response: any) => [
        request,
        response,
      ]) as any);
      router.get("/positional-diag-v5", ({ request }: any) => request);
    });

    const suspects = listPositionalHandlerSuspects();

    expect(suspects).toHaveLength(1);
    expect(suspects[0]).toMatchObject({
      method: "GET",
      path: "/positional-diag-v4",
      sourceFile,
    });
  });

  it("records a [Controller, action] tuple by its bare method name", async () => {
    const controller = {
      showProfile(request: any, response: any) {
        return [request, response];
      },
    };

    await router.withSourceFile(sourceFile, () => {
      router.get("/positional-diag-tuple", [controller, "showProfile"]);
    });

    // `bind` names the function "bound showProfile"; the user wrote "showProfile".
    expect(listPositionalHandlerSuspects()[0].handlerName).toBe("showProfile");
  });

  it("falls back to (anonymous) for an unnamed handler", () => {
    inspectHandlerSignature(
      (function (request: any, response: any) {
        return [request, response];
      }).bind(null),
      { method: "POST", path: "/anon", sourceFile },
    );

    // `bind(null)` on an anonymous expression leaves only the "bound " prefix.
    expect(listPositionalHandlerSuspects()[0].handlerName).toBe("(anonymous)");
  });

  it("drops suspects when their route file is removed", async () => {
    await router.withSourceFile(sourceFile, () => {
      router.get("/positional-diag-removed", ((request: any, response: any) => [
        request,
        response,
      ]) as any);
    });

    expect(listPositionalHandlerSuspects()).toHaveLength(1);

    router.removeRoutesBySourceFile(sourceFile);

    expect(listPositionalHandlerSuspects()).toHaveLength(0);
  });

  it("never throws, whatever it is handed", () => {
    expect(() =>
      inspectHandlerSignature(null, { method: "GET", path: "/null", sourceFile }),
    ).not.toThrow();

    expect(listPositionalHandlerSuspects()).toHaveLength(0);
  });
});

describe("boot-time report", () => {
  const entries: any[] = [];
  const logger = { warn: (entry: any) => entries.push(entry) };

  beforeEach(() => {
    entries.length = 0;
  });

  it("stays silent when nothing is suspect", () => {
    expect(reportPositionalHandlerSuspects(logger as any)).toEqual([]);
    expect(entries).toHaveLength(0);
  });

  it("emits ONE entry listing every suspect", () => {
    inspectHandlerSignature((request: any, response: any) => [request, response], {
      method: "GET",
      path: "/one",
      sourceFile,
    });

    inspectHandlerSignature(
      function second(request: any, response: any) {
        return [request, response];
      },
      { method: "POST", path: "/two", sourceFile },
    );

    const reported = reportPositionalHandlerSuspects(logger as any);

    expect(reported).toHaveLength(2);
    expect(entries).toHaveLength(1);

    const [entry] = entries;

    expect(entry.module).toBe("router");
    expect(entry.message).toContain("2 route handlers look like the v4 positional signature.");
    expect(entry.message).toContain("(GET /one)");
    expect(entry.message).toContain('Handler "second" (POST /two)');
    expect(entry.message).toContain("change it to ({ request, response })");
  });

  it("uses the singular headline for a single suspect", () => {
    inspectHandlerSignature(
      function only(request: any, response: any) {
        return [request, response];
      },
      { method: "PUT", path: "/only", sourceFile },
    );

    reportPositionalHandlerSuspects(logger as any);

    expect(entries[0].message).toContain("1 route handler looks like the v4 positional signature.");
  });
});
