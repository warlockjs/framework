import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseConnector } from "../../../src/connectors/base-connector";
import { ConnectorLifecyclePhase } from "../../../src/connectors/types";
import type { ConnectorName } from "../../../src/connectors/types";

/**
 * Minimal concrete connector used to exercise the abstract `BaseConnector`
 * machinery (`shouldRestart`, `restart`, `isActive`). `watchedFiles` is
 * injectable per test so file-matching cases can be tailored.
 */
class TestConnector extends BaseConnector {
  public readonly name: ConnectorName = "test";
  public readonly priority = 0;
  protected readonly watchedFiles: string[];

  public startCalls = 0;
  public shutdownCalls = 0;

  public constructor(watchedFiles: string[] = []) {
    super();
    this.watchedFiles = watchedFiles;
  }

  public async start(): Promise<void> {
    this.startCalls++;
    this.active = true;
  }

  public async shutdown(): Promise<void> {
    this.shutdownCalls++;
    this.active = false;
  }

  /** Expose the protected matcher for direct assertions. */
  public matches(file: string): boolean {
    return this.isWatchedFile(file);
  }
}

/** Build an absolute path under cwd so `Path.toRelative` yields the relative form. */
const underCwd = (relative: string) => path.resolve(process.cwd(), relative);

describe("BaseConnector — defaults", () => {
  it("defaults the lifecycle phase to Early", () => {
    const connector = new TestConnector();

    expect(connector.lifecyclePhase).toBe(ConnectorLifecyclePhase.Early);
  });

  it("starts inactive and a no-op boot resolves", async () => {
    const connector = new TestConnector();

    expect(connector.isActive()).toBe(false);
    await expect(connector.boot()).resolves.toBeUndefined();
  });

  it("flips active on start and back on shutdown", async () => {
    const connector = new TestConnector();

    await connector.start();
    expect(connector.isActive()).toBe(true);

    await connector.shutdown();
    expect(connector.isActive()).toBe(false);
  });
});

describe("BaseConnector — shouldRestart / isWatchedFile", () => {
  let connector: TestConnector;

  beforeEach(() => {
    connector = new TestConnector(["src/config/log.ts"]);
  });

  it("restarts when a changed file matches a watched file exactly", () => {
    expect(connector.shouldRestart([underCwd("src/config/log.ts")])).toBe(true);
  });

  it("does not restart for an unrelated file", () => {
    expect(connector.shouldRestart([underCwd("src/config/cache.ts")])).toBe(false);
  });

  it("returns false for an empty change set", () => {
    expect(connector.shouldRestart([])).toBe(false);
  });

  it("restarts if ANY file in the set matches", () => {
    const files = [underCwd("src/app/users/routes.ts"), underCwd("src/config/log.ts")];

    expect(connector.shouldRestart(files)).toBe(true);
  });

  it("supports wildcard patterns in watched files", () => {
    const wildcardConnector = new TestConnector(["src/config/*.ts"]);

    expect(wildcardConnector.matches(underCwd("src/config/database.ts"))).toBe(true);
    expect(wildcardConnector.matches(underCwd("src/config/nested/deep.ts"))).toBe(true);
    expect(wildcardConnector.matches(underCwd("src/app/main.ts"))).toBe(false);
  });

  it("matches a normalized (forward-slash) relative path on any platform", () => {
    // Path.toRelative normalizes backslashes to forward slashes before compare.
    expect(connector.matches(underCwd("src/config/log.ts"))).toBe(true);
  });
});

describe("BaseConnector — restart", () => {
  it("shuts down then starts, in that order", async () => {
    const connector = new TestConnector();
    const order: string[] = [];

    vi.spyOn(connector, "shutdown").mockImplementation(async () => {
      order.push("shutdown");
    });
    vi.spyOn(connector, "start").mockImplementation(async () => {
      order.push("start");
    });

    await connector.restart();

    expect(order).toEqual(["shutdown", "start"]);
  });
});
