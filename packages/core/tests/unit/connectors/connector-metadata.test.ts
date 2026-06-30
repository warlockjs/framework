import { describe, expect, it } from "vitest";
import { connectorsManager } from "../../../src/connectors/connectors-manager";
import { ConnectorLifecyclePhase, ConnectorPriority } from "../../../src/connectors/types";
import type { Connector, ConnectorName } from "../../../src/connectors/types";

/**
 * Pins the lifecycle metadata of every built-in connector exposed by the
 * shared `connectorsManager` singleton. These values drive boot ordering and
 * the early/late phase split, so a silent change to a priority or phase is a
 * behavioral regression worth catching.
 */
const byName = (name: ConnectorName): Connector => {
  const connector = connectorsManager.list().find((entry) => entry.name === name);

  if (!connector) {
    throw new Error(`Built-in connector "${name}" is not registered`);
  }

  return connector;
};

describe("built-in connector metadata", () => {
  it("registers exactly the expected built-in connectors", () => {
    const names = connectorsManager
      .list()
      .map((connector) => connector.name)
      .sort();

    expect(names).toEqual(
      [
        "cache",
        "database",
        "herald",
        "http",
        "logger",
        "mailer",
        "socket",
        "storage",
        "notifications",
        "access",
        "ai",
      ].sort(),
    );
  });

  it.each([
    ["logger", ConnectorPriority.LOGGER, ConnectorLifecyclePhase.Early],
    ["mailer", ConnectorPriority.MAILER, ConnectorLifecyclePhase.Early],
    ["database", ConnectorPriority.DATABASE, ConnectorLifecyclePhase.Early],
    ["herald", ConnectorPriority.COMMUNICATOR, ConnectorLifecyclePhase.Early],
    ["cache", ConnectorPriority.CACHE, ConnectorLifecyclePhase.Early],
    ["http", ConnectorPriority.HTTP, ConnectorLifecyclePhase.Late],
    ["storage", ConnectorPriority.STORAGE, ConnectorLifecyclePhase.Early],
    ["socket", ConnectorPriority.SOCKET, ConnectorLifecyclePhase.Late],
    ["notifications", ConnectorPriority.NOTIFICATIONS, ConnectorLifecyclePhase.Early],
    ["access", ConnectorPriority.ACCESS, ConnectorLifecyclePhase.Early],
    ["ai", ConnectorPriority.AI, ConnectorLifecyclePhase.Early],
  ] as const)("%s has the expected priority and phase", (name, priority, phase) => {
    const connector = byName(name);

    expect(connector.priority).toBe(priority);
    expect(connector.lifecyclePhase).toBe(phase);
  });

  it("orders the registered list by ascending priority", () => {
    const priorities = connectorsManager.list().map((connector) => connector.priority);
    const sorted = [...priorities].sort((a, b) => a - b);

    expect(priorities).toEqual(sorted);
  });

  it("boots http and socket in the Late phase (they depend on app-registered state)", () => {
    const lateNames = connectorsManager
      .list()
      .filter((connector) => connector.lifecyclePhase === ConnectorLifecyclePhase.Late)
      .map((connector) => connector.name)
      .sort();

    expect(lateNames).toEqual(["http", "socket"]);
  });
});
