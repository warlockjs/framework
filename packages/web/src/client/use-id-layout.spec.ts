// @vitest-environment jsdom
import { act, createElement, useId, type MouseEvent, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DefaultApp from "../components/default-app";
import { DocumentContext } from "../components/document-context";
import { buildHydratedTree } from "./build-hydrated-tree";
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

// This expected-failure regression documents the unresolved full-document versus
// subtree hydration path. Remove `.fails` only with a proven matching-root fix.
// It exercises React itself and the actual client composer, without rewriting IDs.
describe("layout form identifiers", () => {
  it.fails("keeps server IDs and label/ARIA references equal to hydrated hook IDs", async () => {
    const context = { payload, lang: "en", metadata: undefined };
    const html = renderToString(
      createElement(
        DocumentContext.Provider,
        { value: context },
        createElement(DefaultApp, { children: createElement(Layout, null, createElement(Page)) }),
      ),
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.body.innerHTML = parsed.body.innerHTML;
    const mount = document.getElementById("vessel");
    if (!mount) throw new Error("Missing hydration mount");
    const before = [...mount.querySelectorAll("input")].map((input) => input.id);
    const tree = await buildHydratedTree(
      [
        {
          type: "page",
          name: "forms",
          path: "/forms",
          load: () => ({ Page: { default: Page }, layouts: [{ default: Layout }] }),
        },
      ],
      payload,
    );
    const messages = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          mount,
          createElement(DocumentContext.Provider, { value: context }, tree),
        );
      });
      expect([...mount.querySelectorAll("input")].map((input) => input.id)).toEqual(before);
      for (const input of mount.querySelectorAll("input")) {
        await act(async () => input.click());
        expect(input.dataset.hookId).toBe(input.id);
        expect(mount.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
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
      document.body.innerHTML = "";
    }
  });
});
