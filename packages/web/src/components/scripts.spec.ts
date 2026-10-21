import { createElement } from "react";
import { parse } from "devalue";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentContext, PAYLOAD_SCRIPT_ID, type DocumentContextValue } from "./document-context";
import { markNonHydrating } from "../server/page-render-bundle";
import { Scripts } from "./scripts";
import { NAMED_API_ROUTES_SCRIPT_ID } from "../entry/publish-document-named-api-routes";

/** Pulls the devalue-serialized payload back out of the rendered `<script>` tag. */
function readPayloadFromHtml(html: string): unknown {
  const match = /<script id="__WARLOCK_DATA__"[^>]*>(.*?)<\/script>/.exec(html);

  if (match === null) throw new Error("payload script not found in rendered HTML");

  return parse(match[1]!);
}

function documentValue(overrides: Partial<DocumentContextValue> = {}): DocumentContextValue {
  return {
    metadata: undefined,
    payload: {
      appData: {},
      layoutData: {},
      pageData: {},
      shared: {},
      name: "account",
      locale: "en",
      translations: {},
    },
    ...overrides,
  };
}

function render(value: DocumentContextValue): string {
  return renderToString(
    createElement(DocumentContext.Provider, { value, children: createElement(Scripts, {}) }),
  );
}

describe("Scripts", () => {
  it("emits the __WARLOCK_DATA__ payload for an ordinary document (including a normal app error page)", () => {
    const html = render(documentValue());

    expect(html).toContain(PAYLOAD_SCRIPT_ID);
    expect(readPayloadFromHtml(html)).toMatchObject({ name: "account" });
  });

  it("carries document slots without recursively embedding the payload", () => {
    const value = documentValue({
      lang: "ar",
      dir: "rtl",
      nonce: "request-nonce",
      stylesheetUrls: ["/app.css"],
      hydrationClientModuleUrl: "/hydrate.js",
    });
    const payload = readPayloadFromHtml(render(value));
    expect(payload).toMatchObject({
      name: "account",
      document: {
        lang: "ar",
        dir: "rtl",
        nonce: "request-nonce",
        stylesheetUrls: ["/app.css"],
        hydrationClientModuleUrl: "/hydrate.js",
      },
    });
    if (typeof payload !== "object" || payload === null || !("document" in payload)) {
      throw new Error("Missing serialized document slots");
    }
    expect(payload.document).not.toHaveProperty("payload");
    expect(payload.document).not.toHaveProperty("metadata");
  });

  it("omits the __WARLOCK_DATA__ payload when the payload is marked non-hydrating (renderPageFailure's pre-triple fallback)", () => {
    const html = render(documentValue({ payload: markNonHydrating(documentValue().payload) }));

    expect(html).toBe("");
    expect(html).not.toContain(PAYLOAD_SCRIPT_ID);
  });

  it("carries the request's CSP nonce on the payload script, from the document-context slot", () => {
    const html = render(documentValue({ nonce: "ctx-nonce-1" }));

    expect(html).toContain('nonce="ctx-nonce-1"');
  });

  it("omits the nonce attribute entirely when the request has none", () => {
    const html = render(documentValue({ nonce: undefined }));

    expect(html).not.toContain("nonce=");
  });

  it("renders the hydration client entry module after the payload script, carrying the same nonce", () => {
    const html = render(
      documentValue({ nonce: "ctx-nonce-1", hydrationClientModuleUrl: "/hydrate.js" }),
    );

    expect(html).toContain('<script type="module" nonce="ctx-nonce-1" src="/hydrate.js">');
    expect(html.indexOf(PAYLOAD_SCRIPT_ID)).toBeLessThan(html.indexOf("/hydrate.js"));
  });

  it("omits the hydration client entry module when no URL is configured", () => {
    const html = render(documentValue());

    expect(html).not.toContain('type="module"');
  });

  it("omits the hydration client entry module on a non-hydrating document, even with a URL configured", () => {
    const html = render(
      documentValue({
        payload: markNonHydrating(documentValue().payload),
        hydrationClientModuleUrl: "/hydrate.js",
      }),
    );

    expect(html).toBe("");
  });

  it("embeds the route table once: the payload's document slot does not repeat it", () => {
    const routes = { "orders.get": { path: "/api/orders/:id", method: "GET" } };
    const value = documentValue({
      namedApiRoutes: routes,
      payload: {
        ...documentValue().payload,
        document: { namedApiRoutes: routes, lang: "en" } as never,
      },
    });

    const html = render(value);
    const payload = readPayloadFromHtml(html) as { document?: Record<string, unknown> };

    expect(payload.document).toMatchObject({ lang: "en" });
    expect(payload.document).not.toHaveProperty("namedApiRoutes");
    expect(html.split("/api/orders/:id").length - 1).toBe(1);
  });

  it("emits only browser-safe named API metadata in its dedicated escaped channel", () => {
    const html = render(
      documentValue({ namedApiRoutes: { "orders.get": { path: "/orders/<id>", method: "GET" } } }),
    );
    expect(html).toContain(NAMED_API_ROUTES_SCRIPT_ID);
    expect(html).not.toContain("/orders/<id>");
    expect(html).not.toContain("handler");
  });
});
