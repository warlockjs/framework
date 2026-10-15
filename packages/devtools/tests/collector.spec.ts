import { describe, expect, it, vi } from "vitest";

import { createCollector } from "../src/collector";
import type { ResolvedDevtoolsOptions } from "../src/types";

const options: ResolvedDevtoolsOptions = {
  path: "/__warlock",
  maxRequests: 2,
  nPlusOneThreshold: 5,
};
const start = (collector: ReturnType<typeof createCollector>, id: string) =>
  collector.startRequest({ id, method: "GET", path: `/${id}`, startedAt: 1 });

describe("createCollector", () => {
  it("evicts the oldest request and sends unknown work to background", () => {
    const collector = createCollector(options);
    start(collector, "one");
    start(collector, "two");
    start(collector, "three");
    collector.addQuery("one", {
      connection: "db",
      driver: "postgres",
      sql: "SELECT 1",
      startedAt: 2,
      durationMs: 1,
    });
    expect(collector.listRequests().map((request) => request.id)).toEqual(["three", "two"]);
    expect(collector.getBackground().queries).toHaveLength(1);
  });

  it("isolates throwing subscribers and links mails to live requests", () => {
    const collector = createCollector(options);
    const listener = vi.fn();
    collector.subscribe(() => {
      throw new Error("subscriber failure");
    });
    collector.subscribe(listener);
    start(collector, "one");
    collector.addMail({
      id: "m1",
      requestId: "one",
      capturedAt: 2,
      to: ["a@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      headers: {},
      html: "<p>x</p>",
      attachments: [],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(collector.getRequest("one")?.mails).toEqual(["m1"]);
  });
});
