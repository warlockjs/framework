import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../components/document-context";
import {
  DEFAULT_PAYLOAD_BUDGET_BYTES,
  largestPayloadKeys,
  measureDocumentPayload,
  parsePayloadSize,
  payloadBudgetFor,
  payloadPatternMatches,
  reportPayloadBudget,
  resetPayloadBudgetReports,
  resolvePayloadBudget,
} from "./payload-budget";

function payloadOf(
  overrides: Partial<HydrationDocumentPayloadSource> = {},
): HydrationDocumentPayloadSource {
  return {
    name: "orders.show",
    locale: "en",
    translations: {},
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    ...overrides,
  };
}

const ROUTES = { "orders.show": { path: "/orders/:id", method: "GET" } };

beforeEach(() => {
  resetPayloadBudgetReports();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parsePayloadSize", () => {
  it.each([
    ["4096b", 4096],
    ["64kb", 64 * 1024],
    ["1.5MB", 1.5 * 1024 * 1024],
  ])("reads %s as %i bytes", (size, bytes) => {
    expect(parsePayloadSize(size)).toBe(bytes);
  });

  it.each(["64", "kb", "lots", "-1kb"])("refuses %s", (size) => {
    expect(() => parsePayloadSize(size)).toThrow("Invalid payload budget");
  });
});

describe("payloadPatternMatches", () => {
  it("matches *, ** and ? the way build.budgets does", () => {
    expect(payloadPatternMatches("/orders/*", "/orders/42")).toBe(true);
    expect(payloadPatternMatches("/orders/*", "/orders/42/items")).toBe(false);
    expect(payloadPatternMatches("/admin/**", "/admin/users/1")).toBe(true);
    expect(payloadPatternMatches("/order?", "/orders")).toBe(true);
    expect(payloadPatternMatches("/", "/")).toBe(true);
  });

  it("refuses glob syntax it does not support", () => {
    expect(() => payloadPatternMatches("/orders/[id]", "/orders/1")).toThrow("supported wildcards");
  });
});

describe("resolvePayloadBudget and payloadBudgetFor", () => {
  it("uses the default limit and warn mode when nothing is configured", () => {
    expect(resolvePayloadBudget(undefined)).toEqual({
      page: DEFAULT_PAYLOAD_BUDGET_BYTES,
      pages: [],
      mode: "warn",
    });
  });

  it("lets the last matching route pattern set the limit, and keeps the mode", () => {
    const budget = resolvePayloadBudget({
      page: "32kb",
      pages: { "/admin/**": "96kb", "/admin/users": "128kb" },
      mode: "error",
    });

    expect(payloadBudgetFor(budget, "/orders/1")).toEqual({ bytes: 32 * 1024, mode: "error" });
    expect(payloadBudgetFor(budget, "/admin/roles")).toEqual({ bytes: 96 * 1024, mode: "error" });
    expect(payloadBudgetFor(budget, "/admin/users")).toEqual({ bytes: 128 * 1024, mode: "error" });
  });

  it("refuses a bad mode and a bad size at build time, not at request time", () => {
    expect(() => resolvePayloadBudget({ mode: "fail" as never })).toThrow('"warn" or "error"');
    expect(() => resolvePayloadBudget({ page: "big" })).toThrow("Invalid payload budget");
    expect(() => resolvePayloadBudget({ pages: { "/x/[y]": "1kb" } })).toThrow(
      "supported wildcards",
    );
  });
});

describe("measureDocumentPayload", () => {
  it("splits the inline payload into sections and sums them", () => {
    const measurement = measureDocumentPayload(
      payloadOf({
        pageData: { products: ["a", "b"] },
        layoutData: { nav: "main" },
        translations: { "greeting.hello": "hello" },
        session: { user: { id: 1 } },
      }),
      ROUTES,
    );

    expect(measurement.sections.page).toBeGreaterThan(0);
    expect(measurement.sections.layout).toBeGreaterThan(0);
    expect(measurement.sections.translations).toBeGreaterThan(0);
    expect(measurement.sections.session).toBeGreaterThan(0);
    expect(measurement.sections.routes).toBeGreaterThan(0);
    expect(measurement.total).toBe(
      Object.values(measurement.sections).reduce((sum, bytes) => sum + bytes, 0),
    );
  });

  it("counts the route table once, even when the payload's document slot also carries it", () => {
    const withRouteCopy = measureDocumentPayload(
      payloadOf({ document: { namedApiRoutes: ROUTES, lang: "en" } as never }),
      ROUTES,
    );
    const withoutRouteCopy = measureDocumentPayload(
      payloadOf({ document: { lang: "en" } as never }),
      ROUTES,
    );

    expect(withRouteCopy.sections.other).toBe(withoutRouteCopy.sections.other);
    expect(withRouteCopy.sections.routes).toBeGreaterThan(0);
  });
});

describe("largestPayloadKeys", () => {
  it("lists the largest top-level data keys first", () => {
    const keys = largestPayloadKeys(
      payloadOf({
        pageData: { small: 1, big: "x".repeat(500) },
        layoutData: { nav: "y".repeat(100) },
      }),
    );

    expect(keys.map((entry) => entry.key)).toEqual([
      "pageData.big",
      "layoutData.nav",
      "pageData.small",
    ]);
  });
});

describe("reportPayloadBudget", () => {
  const budget = resolvePayloadBudget({ page: "1b" });

  it("stays silent within budget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    reportPayloadBudget({
      budget: resolvePayloadBudget({ page: "1mb" }),
      route: { name: "orders.show", path: "/orders/:id" },
      payload: payloadOf(),
      routes: ROUTES,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("reports an overage once per route, with the breakdown and the largest keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const input = {
      budget,
      route: { name: "orders.show", path: "/orders/:id" },
      payload: payloadOf({ pageData: { products: "z".repeat(2048) } }),
      routes: ROUTES,
    };

    reportPayloadBudget(input);
    reportPayloadBudget(input);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('Route "orders.show" (/orders/:id)');
    expect(message).toContain("over its 0.0kb budget");
    expect(message).toContain("Sections: page ");
    expect(message).toContain("Largest keys: pageData.products");
  });

  it("logs at error level in error mode", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportPayloadBudget({
      budget: resolvePayloadBudget({ page: "1b", mode: "error" }),
      route: { name: "orders.index", path: "/orders" },
      payload: payloadOf({ pageData: { products: "z".repeat(64) } }),
      routes: undefined,
    });

    expect(error).toHaveBeenCalledOnce();
  });

  it("never throws, and reports a measurement it could not make once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const payload = payloadOf();
    Object.defineProperty(payload, "pageData", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });

    expect(() =>
      reportPayloadBudget({
        budget,
        route: { name: "broken", path: "/broken" },
        payload,
        routes: undefined,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Could not measure"));
  });
});
