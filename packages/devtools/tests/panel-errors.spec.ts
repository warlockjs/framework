import { describe, expect, it, vi } from "vitest";
import { createPanelErrorSource } from "../src/panel-errors";
import type { DevtoolsErrorGroup } from "../src/production/contracts";

const NOW = 10_000_000;

function group(
  overrides: Partial<DevtoolsErrorGroup>,
): DevtoolsErrorGroup & { instances: string[] } {
  return {
    id: "g",
    message: "secret message",
    name: "TypeError",
    source: "request",
    route: "/products/:id",
    status: 500,
    count: 3,
    firstSeen: NOW - 60_000,
    lastSeen: NOW - 1000,
    lastRequestId: "req-1",
    stack: "at secret (/app/file.ts:1:1)",
    instances: ["a"],
    ...overrides,
  };
}

describe("createPanelErrorSource", () => {
  it("answers an empty list until the insights are bound", async () => {
    expect(await createPanelErrorSource(() => NOW).read()).toEqual([]);
  });

  it("keeps the last hour and leaves out the message, stack and request id", async () => {
    const source = createPanelErrorSource(() => NOW);
    const errors = vi.fn(async () => ({
      groups: [
        group({}),
        group({ id: "old", lastSeen: NOW - 3_600_001 }),
        group({ id: "log", source: "log", route: null, status: null, name: null }),
      ],
    }));

    source.bind({ errors });

    const result = await source.read();

    expect(errors).toHaveBeenCalledWith({ instance: "all", limit: 500 });
    expect(result).toEqual([
      {
        route: "/products/:id",
        status: 500,
        name: "TypeError",
        source: "request",
        count: 3,
        firstSeen: NOW - 60_000,
        lastSeen: NOW - 1000,
      },
      {
        route: null,
        status: null,
        name: null,
        source: "log",
        count: 3,
        firstSeen: NOW - 60_000,
        lastSeen: NOW - 1000,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret|req-1/);
  });

  it("stops reading once unbound", async () => {
    const source = createPanelErrorSource(() => NOW);
    const errors = vi.fn(async () => ({ groups: [group({})] }));

    source.bind({ errors });
    source.bind(null);

    expect(await source.read()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});
