// @vitest-environment jsdom
import { Form } from "@mongez/react-form";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TextInput from "../templates/design-system/src/web/design-system/components/text-input";
import CheckboxInput from "../templates/design-system/src/web/design-system/components/checkbox-input";
import RadioInput from "../templates/design-system/src/web/design-system/components/radio-input";
import MultiSelectInput from "../templates/design-system/src/web/design-system/components/multi-select-input";
import SubmitButton from "../templates/design-system/src/web/design-system/components/submit-button";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // jsdom has no layout engine; Radix observes hidden form-input sizes.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
async function submit() {
  await act(async () => {
    element<HTMLFormElement>("form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("generated Mongez controls", () => {
  it("links stable ids, labels, hints and external errors without native validation", async () => {
    await act(async () =>
      root.render(
        createElement(
          Form,
          null,
          createElement(TextInput, {
            id: "profile-name",
            name: "name",
            label: "Name",
            hint: "Public name",
            error: "Choose another name",
          }),
        ),
      ),
    );
    const input = element<HTMLInputElement>("input");
    expect(input.id).toBe("profile-name");
    expect(input.getAttribute("aria-describedby")).toBe("profile-name-hint profile-name-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(element<HTMLLabelElement>("label").htmlFor).toBe(input.id);
    expect(element<HTMLFormElement>("form").noValidate).toBe(true);
    expect(input.hasAttribute("required")).toBe(false);
  });

  it("collects checkbox booleans and an empty multiple selection, excluding submit controls", async () => {
    // Promise-returning handlers release the form's submitting state.
    const onSubmit = vi.fn(async () => undefined);
    await act(async () =>
      root.render(
        createElement(
          Form,
          { onSubmit },
          createElement(CheckboxInput, {
            id: "preferences-enabled",
            name: "enabled",
            label: "Enabled",
          }),
          createElement(MultiSelectInput, {
            id: "preferences-topics",
            name: "topics",
            label: "Topics",
            options: [],
          }),
          createElement(SubmitButton, { id: "preferences-save", name: "save", label: "Save" }),
        ),
      ),
    );
    await submit();
    expect(onSubmit.mock.calls[0]?.[0].values).toEqual({ enabled: false, topics: [] });
    const checkbox = element<HTMLButtonElement>('[role="checkbox"]');
    await act(async () => checkbox.click());
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.getAttribute("data-state")).toBe("checked");
    await submit();
    expect(onSubmit.mock.calls[1]?.[0].values).toEqual({ enabled: true, topics: [] });
  });

  it("registers one scalar radio group with value-based ids and visible selected state", async () => {
    // Promise-returning handlers release the form's submitting state.
    const onSubmit = vi.fn(async () => undefined);
    await act(async () =>
      root.render(
        createElement(
          Form,
          { onSubmit },
          createElement(RadioInput, {
            id: "preferences-color",
            name: "color",
            label: "Color",
            dir: "rtl",
            defaultValue: "blue",
            options: [
              { value: "blue", label: "Blue" },
              { value: "green", label: "Green" },
            ],
          }),
        ),
      ),
    );
    const radio = element<HTMLButtonElement>('[id="preferences-color-option-green"]');
    await act(async () => radio.click());
    expect(radio.getAttribute("aria-checked")).toBe("true");
    expect(radio.getAttribute("data-state")).toBe("checked");
    expect(element<HTMLElement>('[role="radiogroup"]').getAttribute("dir")).toBe("rtl");
    await submit();
    expect(onSubmit.mock.calls[0]?.[0].values).toEqual({ color: "green" });
  });
});
