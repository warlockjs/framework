// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { Form } from "@mongez/react-form";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckboxInput from "../templates/design-system-mantine/src/web/design-system/components/checkbox-input";
import SubmitButton from "../templates/design-system-mantine/src/web/design-system/components/submit-button";
import SwitchInput from "../templates/design-system-mantine/src/web/design-system/components/switch-input";
import TextInput from "../templates/design-system-mantine/src/web/design-system/components/text-input";
import {
  notifyOnSubmit,
  messageFrom,
} from "../templates/design-system-mantine/src/web/design-system/notify";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // jsdom has no layout engine or media queries; Mantine reads both.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  window.matchMedia = globalThis.matchMedia;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function element<T extends Element>(selector: string): T {
  const result = host.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}
async function render(onSubmit: () => Promise<void>) {
  await act(async () =>
    root.render(
      createElement(
        MantineProvider,
        null,
        createElement(
          Form,
          { onSubmit },
          createElement(TextInput, {
            id: "profile-name",
            name: "name",
            label: "Name",
            hint: "Public name",
            required: true,
            rules: [],
          }),
          createElement(CheckboxInput, { id: "terms", name: "terms", label: "Terms" }),
          createElement(SwitchInput, { id: "news", name: "news", label: "News" }),
          createElement(SubmitButton, { id: "send", name: "send", label: "Send" }),
        ),
      ),
    ),
  );
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    element<HTMLFormElement>("form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("Mantine controls bound to Mongez React Form", () => {
  it("links the id, label and hint, and does not use native validation", async () => {
    await render(vi.fn(async () => undefined));
    const input = element<HTMLInputElement>("#profile-name");
    expect(element<HTMLLabelElement>("label").htmlFor).toBe("profile-name");
    expect(element<HTMLFormElement>("form").noValidate).toBe(true);
    expect(input.hasAttribute("required")).toBe(false);
    expect(host.textContent).toContain("Public name");
  });

  it("writes typed values, checkbox and switch booleans to the submitted form values", async () => {
    const onSubmit = vi.fn(async () => undefined);
    await render(onSubmit);
    await type(element<HTMLInputElement>("#profile-name"), "Ada");
    await act(async () => element<HTMLInputElement>("#terms").click());
    await submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const options = (onSubmit.mock.calls[0] as unknown as [{ values: Record<string, unknown> }])[0];
    expect(options.values).toMatchObject({ name: "Ada", terms: true, news: false });
    expect(options.values).not.toHaveProperty("send");
  });

  it("shows a validation error through Mantine's error prop and marks the input invalid", async () => {
    await act(async () =>
      root.render(
        createElement(
          MantineProvider,
          null,
          createElement(
            Form,
            { onSubmit: async () => undefined },
            createElement(TextInput, {
              id: "email-ish",
              name: "email",
              label: "Email",
              error: "Choose another value",
            }),
          ),
        ),
      ),
    );
    const input = element<HTMLInputElement>("#email-ish");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Choose another value");
    const described = input.getAttribute("aria-describedby") ?? "";
    expect(described).not.toBe("");
    expect(host.querySelector(`[id="${described.split(" ").at(-1)}"]`)?.textContent).toBe(
      "Choose another value",
    );
  });
});

describe("notify helpers", () => {
  it("extracts the most specific message from HTTP results, page actions and errors", () => {
    expect(messageFrom({ error: { body: { message: "Email taken" } } })).toBe("Email taken");
    expect(messageFrom({ formErrors: ["Try later"] })).toBe("Try later");
    expect(messageFrom(new Error("boom"))).toBe("boom");
    expect(messageFrom(undefined)).toBeUndefined();
  });

  it("builds onSuccess and onError callbacks for useSubmitForm and useSubmitAction", () => {
    const handlers = notifyOnSubmit({ success: "Saved" });
    expect(typeof handlers.onSuccess).toBe("function");
    expect(typeof handlers.onError).toBe("function");
  });
});
