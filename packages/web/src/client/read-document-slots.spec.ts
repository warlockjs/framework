// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentContext, type DocumentContextValue } from "../components/document-context";
import { Head } from "../components/head";
import { Scripts } from "../components/scripts";
import { readDocumentSlots } from "./read-document-slots";

const value: DocumentContextValue = {
  metadata: { title: "Home", alternates: { fr: "/fr/accueil" } },
  nonce: "n",
  lang: "en",
  stylesheetUrls: ["/a.css", "/b.css"],
  fontPreloads: [{ href: "/inter.woff2", type: "font/woff2" }],
  hydrationClientModuleUrl: "/hydrate.js",
  hydrationClientModulePreloadUrls: ["/vendor-react.js", "/chunk.js"],
  localeAlternates: [
    { hreflang: "en", href: "https://app.test/" },
    { hreflang: "ar", href: "https://app.test/ar" },
  ],
  siteKey: "shop",
  payload: {
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    name: "home",
    locale: "en",
    translations: {},
  },
} as DocumentContextValue;

function documentFor(context: DocumentContextValue): Document {
  const html = renderToString(
    createElement(
      DocumentContext.Provider,
      { value: context },
      createElement(Fragment, null, createElement(Head), createElement(Scripts, {})),
    ),
  );
  const parsed = document.implementation.createHTMLDocument("");

  parsed.head.innerHTML = html;

  return parsed;
}

describe("readDocumentSlots", () => {
  it("rebuilds every slot the inline payload leaves out, in document order", () => {
    expect(readDocumentSlots(documentFor(value))).toEqual({
      stylesheetUrls: ["/a.css", "/b.css"],
      fontPreloads: [{ href: "/inter.woff2", type: "font/woff2" }],
      hydrationClientModuleUrl: "/hydrate.js",
      hydrationClientModulePreloadUrls: ["/vendor-react.js", "/chunk.js"],
      localeAlternates: value.localeAlternates,
      siteKey: "shop",
    });
  });

  it("ignores the page's own metadata alternates and links the app rendered itself", () => {
    const parsed = documentFor(value);

    parsed.head.insertAdjacentHTML(
      "beforeend",
      '<link rel="stylesheet" href="/app-own.css"><link rel="modulepreload" href="/own.js">',
    );

    const slots = readDocumentSlots(parsed);

    expect(slots.stylesheetUrls).toEqual(["/a.css", "/b.css"]);
    expect(slots.hydrationClientModulePreloadUrls).toEqual(["/vendor-react.js", "/chunk.js"]);
    expect(slots.localeAlternates).toHaveLength(2);
  });

  it("leaves a slot absent when the document has no element for it", () => {
    const slots = readDocumentSlots(
      documentFor({ ...value, stylesheetUrls: undefined, siteKey: undefined }),
    );

    expect(slots).not.toHaveProperty("stylesheetUrls");
    expect(slots).not.toHaveProperty("siteKey");
  });
});
