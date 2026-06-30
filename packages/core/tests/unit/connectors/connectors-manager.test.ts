import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsManager } from "../../../src/connectors/connectors-manager";
import { ConnectorLifecyclePhase } from "../../../src/connectors/types";
import type { Connector, ConnectorName } from "../../../src/connectors/types";

/**
 * A no-side-effect test double for the `Connector` contract. Records every
 * lifecycle call into a shared ordered log so a test can assert the manager's
 * boot/start/shutdown sequencing without touching a real database, cache, or
 * HTTP server.
 *
 * @example
 * const log: string[] = [];
 * const db = new FakeConnector("database", 2, ConnectorLifecyclePhase.Early, log);
 * manager.register(db);
 */
class FakeConnector implements Connector {
  public active = false;

  public constructor(
    public readonly name: ConnectorName,
    public readonly priority: number,
    public readonly lifecyclePhase: ConnectorLifecyclePhase,
    private readonly log: string[],
  ) {}

  public isActive(): boolean {
    return this.active;
  }

  public async boot(): Promise<void> {
    this.log.push(`boot:${this.name}`);
  }

  public async start(): Promise<void> {
    this.log.push(`start:${this.name}`);
    this.active = true;
  }

  public async restart(): Promise<void> {
    await this.shutdown();
    await this.start();
  }

  public async shutdown(): Promise<void> {
    this.log.push(`shutdown:${this.name}`);
    this.active = false;
  }

  public shouldRestart(): boolean {
    return false;
  }
}

/**
 * Number of connectors the manager auto-registers in its constructor
 * (logger, mailer, http, database, herald, cache, storage, socket,
 * notifications, access, ai).
 */
const BUILTIN_CONNECTOR_COUNT = 11;

/**
 * Empty the manager's auto-registered built-in connectors in place so a
 * phase/exclusion test starts only the FakeConnectors it adds — the real
 * connectors would otherwise hit live services (storage, database, ...).
 */
const clearBuiltins = (manager: ConnectorsManager): void => {
  const internal = manager as unknown as { connectors: Connector[] };
  internal.connectors.length = 0;
};

describe("ConnectorsManager — registration & priority sort", () => {
  let manager: ConnectorsManager;
  let log: string[];

  beforeEach(() => {
    manager = new ConnectorsManager();
    log = [];
  });

  it("auto-registers the built-in connectors", () => {
    expect(manager.list()).toHaveLength(BUILTIN_CONNECTOR_COUNT);
  });

  it("keeps the list sorted ascending by priority after each register", () => {
    manager.register(new FakeConnector("z-late", 99, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("a-first", -5, ConnectorLifecyclePhase.Early, log));

    const priorities = manager.list().map((connector) => connector.priority);
    const sorted = [...priorities].sort((a, b) => a - b);

    expect(priorities).toEqual(sorted);
  });

  it("places a low-priority connector ahead of a high-priority one", () => {
    manager.register(new FakeConnector("high", 100, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("low", -1, ConnectorLifecyclePhase.Early, log));

    const names = manager.list().map((connector) => connector.name);

    expect(names.indexOf("low")).toBeLessThan(names.indexOf("high"));
  });

  it("registers multiple connectors in a single call", () => {
    manager.register(
      new FakeConnector("one", 50, ConnectorLifecyclePhase.Early, log),
      new FakeConnector("two", 51, ConnectorLifecyclePhase.Early, log),
    );

    expect(manager.list()).toHaveLength(BUILTIN_CONNECTOR_COUNT + 2);
  });
});

describe("ConnectorsManager — start sequencing", () => {
  let manager: ConnectorsManager;
  let log: string[];

  beforeEach(() => {
    manager = new ConnectorsManager();
    log = [];
  });

  it("boots ALL targeted connectors before starting ANY of them", async () => {
    manager.register(new FakeConnector("alpha", 1000, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("beta", 1001, ConnectorLifecyclePhase.Early, log));

    await manager.start(["alpha", "beta"]);

    expect(log).toEqual(["boot:alpha", "boot:beta", "start:alpha", "start:beta"]);
  });

  it("starts only the named connectors when a filter is given", async () => {
    manager.register(new FakeConnector("alpha", 1000, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("beta", 1001, ConnectorLifecyclePhase.Early, log));

    await manager.start(["alpha"]);

    expect(log).toEqual(["boot:alpha", "start:alpha"]);
  });

  it("honors priority order across the boot phase and the start phase", async () => {
    manager.register(new FakeConnector("second", 1001, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("first", 1000, ConnectorLifecyclePhase.Early, log));

    await manager.start(["first", "second"]);

    expect(log).toEqual(["boot:first", "boot:second", "start:first", "start:second"]);
  });
});

describe("ConnectorsManager — startPhase", () => {
  let manager: ConnectorsManager;
  let log: string[];

  beforeEach(() => {
    manager = new ConnectorsManager();
    clearBuiltins(manager);
    log = [];
  });

  it("starts only Early-phase connectors and skips Late ones", async () => {
    manager.register(new FakeConnector("early-svc", 1000, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("late-svc", 1001, ConnectorLifecyclePhase.Late, log));

    await manager.startPhase(ConnectorLifecyclePhase.Early);

    expect(log).toContain("start:early-svc");
    expect(log).not.toContain("start:late-svc");
  });

  it("starts only Late-phase connectors when the Late phase runs", async () => {
    manager.register(new FakeConnector("early-svc", 1000, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("late-svc", 1001, ConnectorLifecyclePhase.Late, log));

    await manager.startPhase(ConnectorLifecyclePhase.Late);

    const mine = log.filter((entry) => entry.endsWith("-svc"));

    expect(mine).toEqual(["boot:late-svc", "start:late-svc"]);
  });
});

describe("ConnectorsManager — startWithout", () => {
  let manager: ConnectorsManager;
  let log: string[];

  beforeEach(() => {
    manager = new ConnectorsManager();
    clearBuiltins(manager);
    log = [];
  });

  it("starts every registered connector except the excluded ones", async () => {
    manager.register(new FakeConnector("keep", 2000, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("drop", 2001, ConnectorLifecyclePhase.Early, log));

    await manager.startWithout(["drop"] as ConnectorName[]);

    expect(log).toContain("start:keep");
    expect(log).not.toContain("start:drop");
  });
});

describe("ConnectorsManager — shutdown", () => {
  let manager: ConnectorsManager;
  let log: string[];

  beforeEach(() => {
    manager = new ConnectorsManager();
    clearBuiltins(manager);
    log = [];
  });

  it("shuts connectors down in reverse registration/priority order", async () => {
    manager.register(new FakeConnector("first", 3000, ConnectorLifecyclePhase.Early, log));
    manager.register(new FakeConnector("second", 3001, ConnectorLifecyclePhase.Early, log));

    await manager.shutdown();

    const mine = log.filter((entry) => entry === "shutdown:first" || entry === "shutdown:second");

    // Highest priority (last in the sorted list) shuts down first.
    expect(mine).toEqual(["shutdown:second", "shutdown:first"]);
  });

  it("continues shutting down remaining connectors when one throws", async () => {
    const survivor = new FakeConnector("survivor", 4000, ConnectorLifecyclePhase.Early, log);
    const thrower = new FakeConnector("thrower", 4001, ConnectorLifecyclePhase.Early, log);

    vi.spyOn(thrower, "shutdown").mockRejectedValueOnce(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    manager.register(survivor);
    manager.register(thrower);

    await expect(manager.shutdown()).resolves.toBeUndefined();

    expect(log).toContain("shutdown:survivor");

    consoleSpy.mockRestore();
  });
});
