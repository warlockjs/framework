// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectActionSubmitter,
  type ActionSubmitOutcome,
} from "../client/navigation/action-submitter";
import { hasDirtyForms } from "../client/navigation/dirty-form-store";
import { Form } from "./form";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(
        Form,
        null,
        createElement("input", { name: "title", defaultValue: "original" }),
        createElement("input", { type: "checkbox", name: "enabled" }),
      ),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  connectActionSubmitter(undefined);
});
function edit(value: string) {
  const input = host.querySelector("input");
  if (!input) throw new Error("Missing input");
  input.value = value;
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() {
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("Form unsent input tracking", () => {
  it("clears on revert, reset, and unmount, including checkbox changes", async () => {
    expect(hasDirtyForms()).toBe(false);
    edit("draft");
    expect(hasDirtyForms()).toBe(true);
    edit("original");
    expect(hasDirtyForms()).toBe(false);
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Missing checkbox");
    checkbox.checked = true;
    act(() => {
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(hasDirtyForms()).toBe(true);
    await act(async () => host.querySelector("form")?.reset());
    expect(hasDirtyForms()).toBe(false);
    edit("draft");
    act(() => root.render(null));
    expect(hasDirtyForms()).toBe(false);
  });

  it("clears after successful submission without requiring a visual reset", async () => {
    connectActionSubmitter(async () => ({ type: "success" }));
    edit("saved");
    await act(async () => submit());
    expect(hasDirtyForms()).toBe(false);
    expect(host.querySelector("input")?.value).toBe("saved");
  });

  it("keeps edits after a rejected submission", async () => {
    connectActionSubmitter(async () => ({
      type: "error",
      actionData: { errors: { title: "Required" } },
    }));
    edit("draft");
    await act(async () => submit());
    expect(hasDirtyForms()).toBe(true);
  });

  it("keeps edits typed after submission began", async () => {
    let finish: (outcome: ActionSubmitOutcome) => void = () => {};
    connectActionSubmitter(
      () =>
        new Promise<ActionSubmitOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    edit("submitted");
    act(() => submit());
    edit("new unsent draft");
    await act(async () => finish({ type: "success" }));
    expect(hasDirtyForms()).toBe(true);
    expect(host.querySelector("input")?.value).toBe("new unsent draft");
  });

  it("does not restore a dirty marker after the submitting form unmounts", async () => {
    let finish: (outcome: ActionSubmitOutcome) => void = () => {};
    connectActionSubmitter(
      () =>
        new Promise<ActionSubmitOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    edit("submitted");
    act(() => submit());
    edit("later edit");
    act(() => root.render(null));
    await act(async () => finish({ type: "success" }));
    expect(hasDirtyForms()).toBe(false);
  });
});
