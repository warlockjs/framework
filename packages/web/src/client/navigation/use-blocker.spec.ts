// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routerEvents } from "../../routing/router-events";
import { useBlocker, type BlockerConfirm } from "./use-blocker";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

function Guard(props: {
  when: boolean | (() => boolean);
  confirm?: BlockerConfirm;
  beforeUnload?: boolean;
}): null {
  useBlocker(props.when, props.confirm, { beforeUnload: props.beforeUnload === true });

  return null;
}

function render(props: Parameters<typeof Guard>[0]): void {
  act(() => root.render(createElement(Guard, props)));
}

const navigation = { to: "/b", from: "/a", type: "link" } as const;

describe("useBlocker", () => {
  it("never prompts while the form is clean", () => {
    const confirm = vi.fn(() => false);

    render({ when: false, confirm });

    expect(routerEvents.emitBeforeNavigate(navigation)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("cancels the navigation when the confirm function answers false", () => {
    const confirm = vi.fn(() => false);

    render({ when: true, confirm });

    expect(routerEvents.emitBeforeNavigate(navigation)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(navigation);
  });

  it("uses the browser confirm dialog for a string message", () => {
    const dialog = vi.spyOn(window, "confirm").mockReturnValue(true);

    render({ when: () => true, confirm: "Discard changes?" });

    expect(routerEvents.emitBeforeNavigate(navigation)).toBe(true);
    expect(dialog).toHaveBeenCalledWith("Discard changes?");
  });

  it("waits for a promised answer", async () => {
    render({ when: true, confirm: async () => false });

    await expect(routerEvents.emitBeforeNavigate(navigation)).resolves.toBe(false);
  });

  it("stops guarding after unmount", () => {
    render({ when: true, confirm: () => false });
    act(() => root.unmount());
    root = createRoot(container);

    expect(routerEvents.emitBeforeNavigate(navigation)).toBe(true);
  });

  it("asks the browser's leave prompt only when opted in and active", () => {
    render({ when: true, confirm: () => true });

    const plain = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);

    render({ when: true, confirm: () => true, beforeUnload: true });

    const guarded = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(guarded);
    expect(guarded.defaultPrevented).toBe(true);

    render({ when: false, confirm: () => true, beforeUnload: true });

    const clean = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
});
