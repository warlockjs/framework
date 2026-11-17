import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstanceInfo } from "../../../src/production/insights";

describe("createInstanceInfo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds the id from host, pid and the start time", () => {
    vi.stubEnv("NODE_APP_INSTANCE", "");
    vi.stubEnv("pm_id", "");
    const info = createInstanceInfo(1_700_000_000_000);

    expect(info.id).toBe(`${os.hostname()}:${process.pid}:${(1_700_000_000_000).toString(36)}`);
    expect(info.startedAt).toBe(1_700_000_000_000);
    expect(info.seenAt).toBe(1_700_000_000_000);
    expect(info.nodeVersion).toBe(process.version);
  });

  it("labels a pm2 worker as host #worker", () => {
    vi.stubEnv("NODE_APP_INSTANCE", "3");
    const info = createInstanceInfo(1);

    expect(info.worker).toBe("3");
    expect(info.label).toBe(`${os.hostname()} #3`);
  });

  it("falls back to pm_id, then to the pid label", () => {
    vi.stubEnv("NODE_APP_INSTANCE", "");
    vi.stubEnv("pm_id", "7");
    expect(createInstanceInfo(1).label).toBe(`${os.hostname()} #7`);

    vi.stubEnv("pm_id", "");
    const plain = createInstanceInfo(1);

    expect(plain.worker).toBeNull();
    expect(plain.label).toBe(`${os.hostname()} pid ${process.pid}`);
  });
});
