import { afterEach, describe, expect, it, vi } from "vitest";

const submitPageAction = vi.fn();
const clearPrefetchCache = vi.fn();

vi.mock("./submit-page-action", () => ({
  submitPageAction: (...args: unknown[]) => submitPageAction(...args),
}));
vi.mock("./prefetch", () => ({ clearPrefetchCache: () => clearPrefetchCache() }));

import { createActionSubmitter, serializeFormData } from "./action-submitter";
import { readSubmitting } from "./submitting-store";

const PAYLOAD = {
  appData: {},
  layoutData: {},
  pageData: {},
  shared: {},
  name: "contact",
  locale: "en",
  translations: {},
};

type Page = { payload: Record<string, unknown>; tree: unknown; routeSource: unknown };

function makeRuntime() {
  let current: Page = { payload: { ...PAYLOAD }, tree: "old", routeSource: PAYLOAD };
  let token = 0;
  const runtime = {
    readCurrent: () => current as never,
    writeCurrent: vi.fn((page: Page) => {
      current = page;
    }),
    buildTree: vi.fn(async () => "new" as never),
    claimTicket: (): {
      isCurrent: () => boolean;
      signal: AbortSignal;
      complete?: () => void;
    } => {
      const mine = ++token;

      return { isCurrent: () => mine === token, signal: new AbortController().signal };
    },
    navigate: vi.fn<(url: string) => void | Promise<void>>(),
    observeTicket: () => {
      const seen = token;

      return () => seen === token;
    },
  };

  return { runtime, page: () => current, newerTicket: () => void runtime.claimTicket() };
}

afterEach(() => vi.clearAllMocks());

describe("createActionSubmitter", () => {
  it("swaps in the payload on success and clears the prefetch cache", async () => {
    const h = makeRuntime();

    submitPageAction.mockResolvedValue({ type: "payload", payload: PAYLOAD, url: "/c" });

    expect(await createActionSubmitter(h.runtime)("/c", new FormData())).toEqual({
      type: "success",
    });
    expect(h.runtime.writeCurrent).toHaveBeenCalledTimes(1);
    expect(h.page().tree).toBe("new");
    expect(clearPrefetchCache).toHaveBeenCalled();
    expect(readSubmitting()).toBe(false);
  });

  it("navigates on a redirect", async () => {
    const h = makeRuntime();

    submitPageAction.mockResolvedValue({ type: "redirect", url: "/thanks" });

    await createActionSubmitter(h.runtime)("/c", new FormData());

    expect(h.runtime.navigate).toHaveBeenCalledWith("/thanks");
    expect(h.runtime.writeCurrent).not.toHaveBeenCalled();
  });

  it("applies actionOnly without rebuilding the tree", async () => {
    const h = makeRuntime();

    submitPageAction.mockResolvedValue({ type: "actionOnly", actionData: { a: 1 }, status: 422 });

    await createActionSubmitter(h.runtime)("/c", new FormData());

    expect(h.runtime.buildTree).not.toHaveBeenCalled();
    expect(h.page().tree).toBe("old");
    expect(h.page().payload.actionData).toEqual({ a: 1 });
  });

  it("shares one request between a double submit", async () => {
    const h = makeRuntime();

    submitPageAction.mockResolvedValue({ type: "payload", payload: PAYLOAD, url: "/c" });

    const submit = createActionSubmitter(h.runtime);
    const first = submit("/c", new FormData());
    const second = submit("/c", new FormData());

    expect(second).toBe(first);
    await first;
    expect(submitPageAction).toHaveBeenCalledTimes(1);
  });

  it("drops the result when a navigation claimed a newer ticket", async () => {
    const h = makeRuntime();
    let resolve: (value: unknown) => void = () => undefined;

    submitPageAction.mockReturnValue(new Promise((r) => (resolve = r)));

    const pending = createActionSubmitter(h.runtime)("/c", new FormData());

    h.newerTicket();
    resolve({ type: "payload", payload: PAYLOAD, url: "/c" });

    expect(await pending).toEqual({ type: "dropped" });
    expect(h.runtime.writeCurrent).not.toHaveBeenCalled();
    expect(clearPrefetchCache).not.toHaveBeenCalled();
  });

  it("keeps the page and reports failed on a hard-fail", async () => {
    const h = makeRuntime();

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    submitPageAction.mockResolvedValue({ type: "hard-fail", reason: "status 500" });

    expect(await createActionSubmitter(h.runtime)("/c", new FormData())).toEqual({
      type: "failed",
      reason: "status 500",
    });
    expect(h.runtime.writeCurrent).not.toHaveBeenCalled();
  });

  // the submission is not over until the redirected page is on screen.
  it("stays submitting until the redirect's navigation settles", async () => {
    const h = makeRuntime();
    let settle: () => void = () => undefined;

    h.runtime.navigate.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    submitPageAction.mockResolvedValue({ type: "redirect", url: "/thanks" });

    let outcome: unknown;
    const pending = createActionSubmitter(h.runtime)("/c", new FormData()).then((value) => {
      outcome = value;
    });

    await vi.waitFor(() => expect(h.runtime.navigate).toHaveBeenCalledWith("/thanks"));
    expect(readSubmitting()).toBe(true);
    expect(outcome).toBeUndefined();

    settle();
    await pending;

    expect(outcome).toEqual({ type: "redirected", url: "/thanks" });
    expect(readSubmitting()).toBe(false);
  });

  it("releases its own ticket before waiting on the redirect", async () => {
    const h = makeRuntime();
    const complete = vi.fn();
    const claimTicket = h.runtime.claimTicket;

    h.runtime.claimTicket = () => ({ ...claimTicket(), complete });
    h.runtime.navigate.mockImplementation(async () => {
      // The navigation runs after the action handed its ticket over.
      await Promise.resolve();
      expect(complete).toHaveBeenCalled();
    });
    submitPageAction.mockResolvedValue({ type: "redirect", url: "/thanks" });

    await createActionSubmitter(h.runtime)("/c", new FormData());

    expect(complete).toHaveBeenCalled();
  });
});

// a Cancel must reach the server while a Start is still pending.
describe("createActionSubmitter — independent submissions", () => {
  function deferred() {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise((r) => (resolve = r));

    return { promise, resolve };
  }

  function form(action: string): FormData {
    const data = new FormData();

    data.set("_action", action);

    return data;
  }

  it("sends an independent submit while an ordinary one is in flight", async () => {
    const h = makeRuntime();
    const start = deferred();

    submitPageAction.mockReturnValueOnce(start.promise);
    submitPageAction.mockResolvedValueOnce({
      type: "actionOnly",
      actionData: { c: 1 },
      status: 422,
    });

    const submit = createActionSubmitter(h.runtime);
    const startPending = submit("/run", form("start"));
    const cancel = submit("/run", form("cancel"), { independent: true });

    expect(cancel).not.toBe(startPending);
    expect(await cancel).toEqual({ type: "error", actionData: { c: 1 } });
    expect(submitPageAction).toHaveBeenCalledTimes(2);
    expect(readSubmitting()).toBe(true);

    // The Start was neither aborted nor superseded by the Cancel.
    start.resolve({ type: "payload", payload: PAYLOAD, url: "/run" });
    expect(await startPending).toEqual({ type: "success" });
    expect(readSubmitting()).toBe(false);
  });

  it("shares one request between a double submit of the same independent action", async () => {
    const h = makeRuntime();

    submitPageAction.mockResolvedValue({ type: "payload", payload: PAYLOAD, url: "/run" });

    const submit = createActionSubmitter(h.runtime);
    const first = submit("/run", form("cancel"), { independent: true });
    const second = submit("/run", form("cancel"), { independent: true });
    const other = submit("/run", form("archive"), { independent: true });

    expect(second).toBe(first);
    expect(other).not.toBe(first);
    await Promise.all([first, other]);
    expect(submitPageAction).toHaveBeenCalledTimes(2);
  });

  it("drops its result when a navigation started after it", async () => {
    const h = makeRuntime();
    const cancel = deferred();

    submitPageAction.mockReturnValueOnce(cancel.promise);

    const pending = createActionSubmitter(h.runtime)("/run", form("cancel"), { independent: true });

    h.newerTicket();
    cancel.resolve({ type: "payload", payload: PAYLOAD, url: "/run" });

    expect(await pending).toEqual({ type: "dropped" });
    expect(h.runtime.writeCurrent).not.toHaveBeenCalled();
  });

  it("is cancelled by its own signal only", async () => {
    const h = makeRuntime();
    const controller = new AbortController();

    submitPageAction.mockImplementationOnce(
      (_url: string, _data: FormData, signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ type: "aborted" }));
        }),
    );

    const pending = createActionSubmitter(h.runtime)("/run", form("cancel"), {
      independent: true,
      signal: controller.signal,
    });

    controller.abort();

    expect(await pending).toEqual({ type: "dropped" });
    expect(readSubmitting()).toBe(false);
  });

  // Review fix: a Cancel per row posts the same action with a different id.
  it("never merges two rows' submissions of the same action", async () => {
    const h = makeRuntime();
    const rowA = deferred();

    submitPageAction.mockReturnValueOnce(rowA.promise);
    submitPageAction.mockResolvedValueOnce({ type: "payload", payload: PAYLOAD, url: "/jobs" });

    const submit = createActionSubmitter(h.runtime);
    const a = form("cancel");
    const b = form("cancel");

    a.set("id", "A");
    b.set("id", "B");

    const first = submit("/jobs", a, { independent: true, dedupeKey: "row-a" });
    const second = submit("/jobs", b, { independent: true, dedupeKey: "row-b" });

    expect(second).not.toBe(first);
    expect(submitPageAction).toHaveBeenCalledTimes(2);
    expect((submitPageAction.mock.calls[1]![1] as FormData).get("id")).toBe("B");

    rowA.resolve({ type: "payload", payload: PAYLOAD, url: "/jobs" });
    await Promise.all([first, second]);
  });

  it("does not merge the same form submitted with different fields", async () => {
    const h = makeRuntime();

    submitPageAction.mockResolvedValue({ type: "payload", payload: PAYLOAD, url: "/jobs" });

    const submit = createActionSubmitter(h.runtime);
    const a = form("cancel");
    const b = form("cancel");

    a.set("id", "A");
    b.set("id", "B");

    const first = submit("/jobs", a, { independent: true, dedupeKey: "row" });
    const second = submit("/jobs", b, { independent: true, dedupeKey: "row" });

    expect(second).not.toBe(first);
    await Promise.all([first, second]);
    expect(submitPageAction).toHaveBeenCalledTimes(2);
  });

  // Review fix: a "Stop" in a persistent layout must not pull the user off the
  // page they navigated to after submitting it.
  it("drops its redirect when a navigation started after it", async () => {
    const h = makeRuntime();
    const stop = deferred();

    submitPageAction.mockReturnValueOnce(stop.promise);

    const pending = createActionSubmitter(h.runtime)("/run", form("stop"), { independent: true });

    h.newerTicket();
    stop.resolve({ type: "redirect", url: "/jobs" });

    expect(await pending).toEqual({ type: "dropped" });
    expect(h.runtime.navigate).not.toHaveBeenCalled();
  });

  it("drops its redirect when its own signal aborted", async () => {
    const h = makeRuntime();
    const controller = new AbortController();
    const stop = deferred();

    submitPageAction.mockReturnValueOnce(stop.promise);

    const pending = createActionSubmitter(h.runtime)("/run", form("stop"), {
      independent: true,
      signal: controller.signal,
    });

    controller.abort();
    stop.resolve({ type: "redirect", url: "/jobs" });

    expect(await pending).toEqual({ type: "dropped" });
    expect(h.runtime.navigate).not.toHaveBeenCalled();
  });
});

describe("serializeFormData", () => {
  it("distinguishes fields and identifies files without reading them", () => {
    const a = new FormData();
    const b = new FormData();

    a.set("id", "1");
    b.set("id", "2");

    expect(serializeFormData(a)).not.toBe(serializeFormData(b));

    const withFile = new FormData();

    withFile.set("upload", new File(["abc"], "a.txt", { type: "text/plain", lastModified: 1 }));

    expect(serializeFormData(withFile)).toContain("a.txt:3:text/plain:1");
  });
});
