import { describe, expect, it } from "vitest";
import { Response } from "./response";
import type { XMLable } from "./xmlable";

/**
 * `response.xml(body)` — structurally typed on `XMLable` (`{ toXML(): string }`)
 * so `@warlock.js/sitemap` never needs to import core. Mirrors the mock shape
 * used by `csp.spec.ts` / `request-tracing.spec.ts`: a bare `Response` wired
 * to a fake Fastify reply, no server.
 */

function createResponse() {
  const headers: Record<string, string> = {};
  let sentBody: unknown;
  let sentStatusCode: number | undefined;

  const response = new Response();

  response.setResponse({
    header: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
    status: (code: number) => {
      sentStatusCode = code;
      return baseResponse;
    },
    send: (body: unknown) => {
      sentBody = body;
    },
    sent: false,
    raw: { once: () => {} },
  } as never);

  const baseResponse = response.baseResponse;

  return { response, headers, getSentBody: () => sentBody, getStatusCode: () => sentStatusCode };
}

describe("response.xml", () => {
  it("sends a string body as-is", async () => {
    const { response, getSentBody } = createResponse();

    await response.xml("<a/>");

    expect(getSentBody()).toBe("<a/>");
  });

  it("calls toXML() on an XMLable body and sends its result", async () => {
    const { response, getSentBody } = createResponse();

    const xmlable: XMLable = {
      toXML: () => "<urlset></urlset>",
    };

    await response.xml(xmlable);

    expect(getSentBody()).toBe("<urlset></urlset>");
  });

  it("sets the content type to application/xml", async () => {
    const { response, headers } = createResponse();

    await response.xml("<a/>");

    expect(headers["Content-Type"]).toBe("application/xml");
  });

  it("returns the response for chaining", async () => {
    const { response } = createResponse();

    const result = await response.xml("<a/>");

    expect(result).toBe(response);
  });

  it("throws a clear TypeError instead of a confusing crash for a non-XMLable object", () => {
    const { response } = createResponse();

    expect(() => response.xml({ toXML: "not a function" } as never)).toThrowError(
      /response\.xml\(\) expects a string or an XMLable value/,
    );
  });
});

describe("response.xml — XMLable structural typing (type-level, no runtime assertions)", () => {
  /**
   * `@warlock.js/sitemap` is a peer dependency core does not install in its
   * own `node_modules` (nothing under `node_modules/@warlock.js/sitemap`
   * here), so this cannot `import type { Sitemap } from "@warlock.js/sitemap"`
   * directly. A local class shaped exactly like the real `Sitemap` — only a
   * `toXML(): string` method, nothing else `XMLable` requires — stands in for
   * it: if this type-checks, a real `Sitemap` instance does too, since
   * `XMLable` is structural (`core/src/http/xmlable.ts`) and imposes no
   * nominal/branded requirement `Sitemap` would need to opt into.
   */
  class FakeSitemap {
    toXML(): string {
      return "<urlset></urlset>";
    }
  }

  it("type-checks a class with only toXML() as an XMLable response body", () => {
    const { response } = createResponse();
    const sitemap = new FakeSitemap();

    // No `as XMLable`, no `as never` — this line only compiles if `FakeSitemap`
    // is already structurally assignable to `XMLable`.
    const assertAcceptsXMLable: (body: XMLable) => void = (body) => void response.xml(body);
    assertAcceptsXMLable(sitemap);

    expect(sitemap.toXML()).toBe("<urlset></urlset>");
  });
});
