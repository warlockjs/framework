// @vitest-environment jsdom
import { Form, useFormControl } from "@mongez/react-form";
import { act, createElement, type ChangeEvent, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readHydrationPayload } from "../hydration-payload";
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

type ControlProps = { readonly name: string; readonly label: string };

/** A control built on the form library's id derivation, the way an app's design system builds one. */
function Control({ name, label }: ControlProps) {
  const { id, value, changeValue } = useFormControl({ name });

  return createElement(
    "div",
    null,
    createElement("label", { htmlFor: id }, label),
    createElement("input", {
      id,
      name: name || undefined,
      "aria-describedby": `${id}-hint`,
      value: typeof value === "string" ? value : "",
      onChange: (event: ChangeEvent<HTMLInputElement>) => changeValue(event.target.value),
    }),
    createElement("span", { id: `${id}-hint` }, "Hint"),
  );
}

function Page() {
  return createElement(
    "section",
    null,
    createElement(
      Form,
      { id: "signup" },
      createElement(Control, { name: "email", label: "Email" }),
      createElement(Control, { name: "", label: "Nameless" }),
    ),
    createElement(
      Form,
      null,
      createElement(Control, { name: "email", label: "Email again" }),
      createElement(Control, { name: "", label: "Nameless again" }),
    ),
  );
}

function Layout({ children }: { children?: ReactNode }) {
  return createElement("main", null, children);
}

describe("form control identifiers through server render and hydration", () => {
  it("keeps every default control id after hydrating a page with forms, with no mismatch warning", async () => {
    const context = { payload, lang: "en", metadata: undefined };
    const html = renderToString(
      createElement(
        DocumentContext.Provider,
        { value: context },
        createElement(DefaultApp, { children: createElement(Layout, null, createElement(Page)) }),
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
    const before = [...document.querySelectorAll("input")].map((input) => input.id);

    // The named control of a form with an id uses that id; the others derive theirs from `useId()`.
    expect(before).toHaveLength(4);
    expect(before[0]).toBe("signup-email");
    expect(new Set(before).size).toBe(4);
    for (const id of before) expect(id).not.toMatch(/undefined|^input-email$/);
    expect([...document.forms].map((form) => form.method)).toEqual(["post", "post"]);
    expect(before[1]).toMatch(/^signup-\S+$/);

    const pages = [
      {
        type: "page",
        name: "forms",
        path: "/forms",
        load: () => ({ Page: { default: Page }, layouts: [{ default: Layout }] }),
      },
    ] satisfies readonly ClientPageEntry[];
    const tree = await buildHydratedTree(pages, documentPayload);
    const fullTree = buildHydrationDocument({ default: DefaultApp }, documentPayload, tree);
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
        expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
        expect(document.getElementById(`${input.id}-hint`)).not.toBeNull();
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
