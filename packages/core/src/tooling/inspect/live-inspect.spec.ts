import events from "@mongez/events";
import { afterEach, describe, expect, it } from "vitest";
import { liveInspectOptions, startLiveEventRecording } from "./live-inspect";

const RECORDER_KEY = Symbol.for("warlock.liveEventRecorder");

/** Registers `callback` on `event` as if the module loader were importing `file`. */
function subscribeFrom(file: string, event: string, callback: () => void): void {
  const previous = Reflect.get(globalThis, "__currentModuleFile");

  Reflect.set(globalThis, "__currentModuleFile", { relativePath: file });

  try {
    events.subscribe(event, callback);
  } finally {
    Reflect.set(globalThis, "__currentModuleFile", previous);
  }
}

afterEach(() => {
  const recorder = Reflect.get(globalThis, RECORDER_KEY) as { stop?: () => void } | undefined;

  recorder?.stop?.();
  Reflect.deleteProperty(globalThis, RECORDER_KEY);
  events.unsubscribeNamespace("live-inspect-spec");
});

describe("live event facts", () => {
  it("lists nothing before recording starts", () => {
    expect(liveInspectOptions()).toEqual({ events: [] });
  });

  it("notes the module that registers each listener, once, however often it reloads", () => {
    startLiveEventRecording();
    // A second start (a restart path) keeps the same recorder.
    startLiveEventRecording();

    function notifyStock() {}

    subscribeFrom(
      "src/app/products/events/notify-stock.ts",
      "live-inspect-spec.product.saved",
      notifyStock,
    );
    // The same module imported again after an edit registers the listener again.
    subscribeFrom(
      "src/app/products/events/notify-stock.ts",
      "live-inspect-spec.product.saved",
      notifyStock,
    );
    // Framework code (no module being imported) is not an app fact.
    events.subscribe("live-inspect-spec.product.saved", () => undefined);

    expect(liveInspectOptions().events).toEqual([
      {
        event: "live-inspect-spec.product.saved",
        name: "notifyStock",
        sourceFile: "src/app/products/events/notify-stock.ts",
      },
    ]);
  });

  it("reads a recorder another copy of the module put on globalThis", () => {
    const listed = [
      { event: "orders.paid", name: "ship", sourceFile: "src/app/orders/events/ship.ts" },
    ];

    Reflect.set(globalThis, RECORDER_KEY, { list: () => listed });

    expect(liveInspectOptions().events).toEqual(listed);
  });
});
