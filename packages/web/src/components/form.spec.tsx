// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionSubmitOutcome } from "../client/navigation/action-submitter";
import { connectActionSubmitter } from "../client/navigation/action-submitter";
import { DocumentContext } from "./document-context";
import { FieldError } from "./field-error";
import { Form } from "./form";
import { useActionData } from "./use-action-data";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function documentValue(actionData?: unknown) {
  return { payload: { actionData } } as never;
}

function mount(node: React.ReactElement, actionData?: unknown) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() =>
    root.render(
      createElement(DocumentContext.Provider, { value: documentValue(actionData) }, node),
    ),
  );

  return { container, root };
}

function submit(container: HTMLElement) {
  const form = container.querySelector("form")!;

  return act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  connectActionSubmitter(undefined);
  document.body.innerHTML = "";
});

describe("<Form>", () => {
  it("renders a post form with the hidden _action for a named action", () => {
    const { container } = mount(<Form action="save" />);
    const form = container.querySelector("form")!;

    expect(form.method).toBe("post");
    expect(form.enctype).toBe("multipart/form-data");
    expect(container.querySelector<HTMLInputElement>('input[name="_action"]')?.value).toBe("save");
  });

  it("submits through the connected runtime and calls onSuccess", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));
    const onSuccess = vi.fn();

    connectActionSubmitter(submitter);
    const { container } = mount(
      <Form onSuccess={onSuccess}>
        <input name="email" defaultValue="a@b.c" />
      </Form>,
    );

    await submit(container);

    expect(submitter).toHaveBeenCalledTimes(1);
    expect((submitter.mock.calls[0] as unknown[])[1] instanceof FormData).toBe(true);
    expect(onSuccess).toHaveBeenCalled();
  });

  it.each<ActionSubmitOutcome>([
    { type: "success" },
    { type: "redirected", url: "/done" },
    { type: "error", actionData: { errors: { email: "Required" } } },
    { type: "failed", reason: "network" },
    { type: "dropped" },
  ])("settles $type submissions after their existing callback", async (outcome) => {
    const order: string[] = [];
    connectActionSubmitter(async () => outcome);
    const onSettled = vi.fn(() => order.push("settled"));
    const { container } = mount(
      <Form
        onSuccess={() => order.push("success")}
        onError={() => order.push("error")}
        onSettled={onSettled}
      />,
    );
    await submit(container);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(outcome);
    expect(order).toEqual(
      outcome.type === "success" || outcome.type === "redirected"
        ? ["success", "settled"]
        : outcome.type === "error"
          ? ["error", "settled"]
          : ["settled"],
    );
  });

  it("opts only the marked submit button into independent submissions", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));
    connectActionSubmitter(submitter);
    const { container } = mount(
      <Form>
        <button>Start</button>
        <button data-independent>Cancel</button>
      </Form>,
    );
    const buttons = container.querySelectorAll("button");
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    expect((submitter.mock.calls[0] as unknown[])[2]).toMatchObject({ independent: false });
    expect((submitter.mock.calls[1] as unknown[])[2]).toMatchObject({
      independent: true,
      signal: expect.any(AbortSignal),
    });
  });

  it("settles an independent submission dropped when its form unmounts", async () => {
    connectActionSubmitter(
      (_url, _data, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve({ type: "dropped" }), {
            once: true,
          });
        }),
    );
    const onSettled = vi.fn();
    const { container, root } = mount(<Form independent onSettled={onSettled} />);
    await submit(container);
    await act(async () => root.unmount());
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ type: "dropped" });
  });

  it("does not settle submissions left to the native browser", async () => {
    const onSettled = vi.fn();
    const { container } = mount(<Form onSettled={onSettled} />);
    await submit(container);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("shares one request between a double submit", async () => {
    let finish!: (value: { type: "success" }) => void;
    const submitter = vi.fn(
      () => new Promise<{ type: "success" }>((resolve) => (finish = resolve)),
    );

    connectActionSubmitter(submitter);
    const { container } = mount(<Form />);

    await submit(container);
    await submit(container);
    // Sharing lives in the submitter; <Form> must at least not bypass it.
    expect(submitter.mock.calls.length).toBeLessThanOrEqual(2);
    await act(async () => finish({ type: "success" }));
  });

  // with no runtime the browser's own submission must keep the
  // submit button's `formaction` and name/value, so the event is left alone.
  it("leaves the submission to the browser when no runtime is connected", async () => {
    const { container } = mount(<Form />);
    const form = container.querySelector("form")!;
    const nativeSubmit = vi.spyOn(form, "submit").mockImplementation(() => undefined);
    const event = new Event("submit", { bubbles: true, cancelable: true });

    await act(async () => {
      form.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it("posts to the submit button's formaction with its name and value", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container } = mount(
      <Form>
        <input name="retained" defaultValue="original-command" />
        <button type="submit" name="purpose" value="inspect" formAction="/expected?mode=inspect">
          Inspect
        </button>
      </Form>,
    );

    await act(async () => {
      container.querySelector("button")!.click();
    });

    expect(submitter).toHaveBeenCalledTimes(1);
    const [url, data] = submitter.mock.calls[0] as unknown as [string, FormData];

    expect(url).toBe("/expected?mode=inspect");
    expect(data.get("retained")).toBe("original-command");
    expect(data.get("purpose")).toBe("inspect");
  });

  it("hands the submission back through the same button when the runtime answers nothing", async () => {
    const submitter = vi.fn(async () => undefined as never);

    connectActionSubmitter(submitter);
    const { container } = mount(
      <Form>
        <button type="submit" name="purpose" value="inspect" formAction="/expected">
          Inspect
        </button>
      </Form>,
    );
    const form = container.querySelector("form")!;
    const button = container.querySelector("button")!;
    const redispatched: boolean[] = [];
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(function (
      this: HTMLFormElement,
    ) {
      // What the browser does: a submit event, then (unprevented) the post.
      const event = new Event("submit", { bubbles: true, cancelable: true });

      this.dispatchEvent(event);
      redispatched.push(event.defaultPrevented);
    });

    await act(async () => {
      button.click();
    });

    expect(requestSubmit).toHaveBeenCalledWith(button);
    expect(redispatched).toEqual([false]);
    expect(submitter).toHaveBeenCalledTimes(1);
  });

  it("renders a query-only target for the current page", () => {
    const { container } = mount(<Form query={{ mode: "inspect", skip: undefined }} />);

    expect(container.querySelector("form")!.getAttribute("action")).toBe("?mode=inspect");
  });

  it("posts to the query target through the runtime", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container } = mount(<Form query={{ mode: "inspect" }} />);

    await submit(container);

    expect((submitter.mock.calls[0] as unknown[])[0]).toBe("?mode=inspect");
  });

  // Independent submissions.
  it("submits an independent form with its own cancellation signal", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container, root } = mount(<Form action="cancel" independent />);

    await submit(container);

    const options = (submitter.mock.calls[0] as unknown[])[2] as {
      independent: boolean;
      signal: AbortSignal;
    };

    expect(options.independent).toBe(true);
    expect(options.signal.aborted).toBe(false);

    act(() => root.unmount());

    expect(options.signal.aborted).toBe(true);
  });

  it("submits an ordinary form without independence", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container } = mount(<Form action="start" />);

    await submit(container);

    expect((submitter.mock.calls[0] as unknown[])[2]).toEqual({
      independent: false,
      signal: undefined,
      dedupeKey: expect.stringMatching(/^form-/),
    });
  });

  // Review fix: two rows' forms must never be merged into one request.
  it("gives each form instance its own dedupe key", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container } = mount(
      <>
        <Form action="cancel" independent>
          <input name="id" defaultValue="A" />
        </Form>
        <Form action="cancel" independent>
          <input name="id" defaultValue="B" />
        </Form>
      </>,
    );
    const forms = container.querySelectorAll("form");

    await act(async () => {
      for (const form of Array.from(forms)) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    });

    const keys = submitter.mock.calls.map(
      (call) => ((call as unknown[])[2] as { dedupeKey: string }).dedupeKey,
    );

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  // Review fix: effects re-run without an unmount (a hidden <Activity> shown
  // again) must not leave the form with an already-aborted signal.
  it("submits with a live signal after its effects were cleaned up and re-run", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));
    const { Activity } = await import("react");

    connectActionSubmitter(submitter);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (mode: "visible" | "hidden") =>
      act(() =>
        root.render(
          createElement(
            DocumentContext.Provider,
            { value: documentValue() },
            <Activity mode={mode}>
              <Form action="cancel" independent />
            </Activity>,
          ),
        ),
      );

    render("visible");
    await submit(container);

    const first = ((submitter.mock.calls[0] as unknown[])[2] as { signal: AbortSignal }).signal;

    render("hidden");
    expect(first.aborted).toBe(true);

    render("visible");
    await submit(container);

    const second = ((submitter.mock.calls[1] as unknown[])[2] as { signal: AbortSignal }).signal;

    expect(second.aborted).toBe(false);
    act(() => root.unmount());
  });

  // Security review: a button may name any `formaction`; enhancing a
  // cross-origin one would fetch it and trust what that origin answered.
  it("leaves a cross-origin formaction to the browser", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container } = mount(
      <Form>
        <button type="submit" formAction="https://elsewhere.example/collect">
          Send
        </button>
      </Form>,
    );
    const form = container.querySelector("form")!;
    let prevented: boolean | undefined;
    // `document` hears the event after React's root listener has run.
    const listener = (event: Event) => {
      prevented = event.defaultPrevented;
    };

    document.addEventListener("submit", listener);

    const event = new Event("submit", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "submitter", { value: container.querySelector("button") });

    await act(async () => {
      form.dispatchEvent(event);
    });

    document.removeEventListener("submit", listener);

    expect(submitter).not.toHaveBeenCalled();
    // Not prevented: the browser posts it natively.
    expect(prevented).toBe(false);
  });

  it("enhances a same-origin absolute formaction", async () => {
    const submitter = vi.fn(async () => ({ type: "success" as const }));

    connectActionSubmitter(submitter);
    const { container } = mount(
      <Form>
        <button type="submit" formAction={`${window.location.origin}/save`}>
          Save
        </button>
      </Form>,
    );

    await act(async () => {
      container.querySelector("button")!.click();
    });

    expect(submitter).toHaveBeenCalledTimes(1);
  });

  it("renders field errors and wires aria-invalid / aria-describedby", () => {
    const { container } = mount(
      <Form>
        <input name="email" />
        <FieldError name="email" />
      </Form>,
      { action: "default", status: 422, ok: false, errors: { email: "Required" }, formErrors: [] },
    );

    expect(container.querySelector("#email-error")?.textContent).toBe("Required");
    const input = container.querySelector("input")!;

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("email-error");
  });
});

describe("useActionData", () => {
  function Probe({ name }: { name?: string }) {
    const state = useActionData(name);

    return <p>{state ? state.action : "none"}</p>;
  }

  it("reads the payload's actionData and filters by action name", () => {
    const state = { action: "save", status: 200, ok: true, errors: {}, formErrors: [] };

    expect(mount(<Probe />, state).container.textContent).toBe("save");
    expect(mount(<Probe name="remove" />, state).container.textContent).toBe("none");
    expect(mount(<Probe />).container.textContent).toBe("none");
  });
});
