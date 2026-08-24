import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * `request.on()` (core/src/http/request.ts:616) subscribes to the same
 * `request.${eventName}` channel `request.trigger()` (:609) publishes on,
 * via the shared `events` bus (@mongez/events).
 */
describe("Request — on/trigger", () => {
  it("fires the subscribed callback when the matching event is triggered", () => {
    const request = new Request();

    let received: unknown;
    request.on("executingMiddleware" as any, (arg: unknown) => {
      received = arg;
    });

    request.trigger("executingMiddleware" as any, "payload");

    expect(received).toBe("payload");
  });

  it("stops receiving events once unsubscribed", () => {
    const request = new Request();

    let calls = 0;
    const subscription = request.on("executedMiddleware" as any, () => {
      calls++;
    });

    request.trigger("executedMiddleware" as any);
    subscription.unsubscribe();
    request.trigger("executedMiddleware" as any);

    expect(calls).toBe(1);
  });
});
