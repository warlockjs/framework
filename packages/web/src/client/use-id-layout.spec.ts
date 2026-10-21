// @vitest-environment jsdom
import { act, createElement, useId, type MouseEvent, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readHydrationPayload } from "../hydration-payload";
import { Scripts } from "../components/scripts";
import { buildHydrationDocument } from "./build-hydration-document";
import DefaultApp from "../components/default-app";
import { DocumentContext } from "../components/document-context";
import { buildHydratedTree } from "./build-hydrated-tree";
import type { ClientPageEntry } from "./runtime";
import type { HydrationDocumentPayloadSource } from "../hydration-payload";

const payload: HydrationDocumentPayloadSource = {
  name: "forms",
  locale: "en",
  translations: {},
  appData: null,
  layoutData: null,
  pageData: null,
  shared: {},
};

function Field() {
  const id = useId();
  return createElement(
    "div",
    null,
    createElement("label", { htmlFor: id }, "Name"),
    createElement("input", {
      id,
      "aria-describedby": `${id}-hint`,
      onClick: (event: MouseEvent<HTMLInputElement>) => {
        event.currentTarget.dataset.hookId = id;
      },
    }),
    createElement("span", { id: `${id}-hint` }, "Enter a name"),
  );
}
function Page() {
  return createElement("form", null, createElement(Field), createElement(Field));
}
function Layout({ children }: { children?: ReactNode }) {
  return createElement("main", null, createElement(Field), children);
}

function CustomApp({ children }: { children?: ReactNode }) {
  const id = useId();
  return createElement(
    "html",
    { lang: "en" },
    createElement("head"),
    createElement(
      "body",
      { "data-root-id": id },
      createElement("aside", null, createElement(Field)),
      createElement("div", { id: "vessel" }, children),
      createElement(Scripts, {}),
    ),
  );
}

describe("layout form identifiers", () => {
  it.each([
    { name: "default root", App: DefaultApp },
    { name: "custom root", App: CustomApp },
  ])("keeps SSR and hydrated hook IDs equal with $name", async ({ App }) => {
    const context = { payload, lang: "en", metadata: undefined };
    const html = renderToString(
      createElement(
        DocumentContext.Provider,
        { value: context },
        createElement(App, { children: createElement(Layout, null, createElement(Page)) }),
      ),
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const attribute of [...document.documentElement.attributes]) {
      document.documentElement.removeAttribute(attribute.name);
    }
    for (const attribute of parsed.documentElement.attributes) {
      document.documentElement.setAttribute(attribute.name, attribute.value);
    }
    document.documentElement.innerHTML = parsed.documentElement.innerHTML;
    const documentPayload = readHydrationPayload(document);
    const mount = document.getElementById("vessel");
    if (!mount) throw new Error("Missing hydration mount");
    const before = [...document.querySelectorAll("input")].map((input) => input.id);
    const pages = [
      {
        type: "page",
        name: "forms",
        path: "/forms",
        load: () => ({ Page: { default: Page }, layouts: [{ default: Layout }] }),
      },
    ] satisfies readonly ClientPageEntry[];
    const tree = await buildHydratedTree(pages, documentPayload);
    const fullTree = buildHydrationDocument({ default: App }, documentPayload, tree);
    const messages = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          document,
          createElement(
            DocumentContext.Provider,
            { value: { ...context, ...documentPayload.document, payload: documentPayload } },
            fullTree,
          ),
        );
      });
      expect([...document.querySelectorAll("input")].map((input) => input.id)).toEqual(before);
      for (const input of document.querySelectorAll("input")) {
        await act(async () => input.click());
        expect(input.dataset.hookId).toBe(input.id);
        expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
        expect(
          document.getElementById(input.getAttribute("aria-describedby") ?? ""),
        ).not.toBeNull();
      }
      expect(messages.mock.calls.flat().map(String).join(" ")).not.toMatch(
        /didn't match|hydration|hydrated/i,
      );
    } finally {
      await act(async () => root?.unmount());
      messages.mockRestore();
      document.documentElement.innerHTML = "<head></head><body></body>";
    }
  });
});
