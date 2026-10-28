import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identity } from "../src/identity";
import {
  helperArguments,
  helperScript,
  WindowsProcessHelper,
  type HelperChild,
} from "../src/windows-helper";

const originalPlatform = process.platform;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

type Table = Record<number, { parent: number; start: string; rss: number }>;
type Fake = HelperChild & {
  requests: { id: number; pids: number[]; all: boolean }[];
  die(): void;
  exited: boolean;
  killed: boolean;
};

/** A stand-in for the PowerShell helper that speaks the same line protocol. */
function fakeHelper(table: Table, behaviour: { mute?: boolean; error?: string } = {}) {
  const children: Fake[] = [];
  const spawn = (): HelperChild => {
    const stdout = new PassThrough();
    const exits: (() => void)[] = [];
    const child: Fake = {
      requests: [],
      exited: false,
      killed: false,
      stdout,
      stdin: new Writable({
        write(chunk, _encoding, callback) {
          for (const line of chunk.toString().split("\n").filter(Boolean)) {
            const request = JSON.parse(line) as { id: number; pids: number[]; all: boolean };
            child.requests.push(request);
            if (behaviour.mute) continue;
            const rows = Object.entries(table)
              .filter(([pid]) => request.all || request.pids.includes(Number(pid)))
              .map(([pid, row]) => ({ pid: Number(pid), ...row }));
            stdout.write(
              JSON.stringify(
                behaviour.error
                  ? { id: request.id, error: behaviour.error }
                  : { id: request.id, rows },
              ) + "\n",
            );
          }
          callback();
        },
      }),
      on(event, listener) {
        if (event === "exit") exits.push(listener);
      },
      kill() {
        child.killed = true;
        child.die();
      },
      die() {
        if (child.exited) return;
        child.exited = true;
        for (const listener of exits) listener();
      },
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

const table: Table = {
  10: { parent: 1, start: "638000000000000010", rss: 100 },
  11: { parent: 10, start: "638000000000000011", rss: 50 },
  12: { parent: 1, start: "638000000000000012", rss: 25 },
};

describe("windows process helper protocol", () => {
  it("starts lazily and answers a query", async () => {
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    expect(fake.children).toHaveLength(0);
    const rows = await helper.query([10]);
    expect(rows.map((row) => row.pid)).toEqual([10]);
    expect(rows[0]).toMatchObject({ parent: 1, rss: 100, group: 10, state: "R" });
    expect(helper.starts).toBe(1);
    await helper.close();
  });

  it("answers N concurrent PID queries with one request", async () => {
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    const results = await Promise.all([helper.query([10]), helper.query([11]), helper.query([12])]);
    expect(results.map((rows) => rows.length)).toEqual([3, 3, 3]);
    expect(fake.children[0]?.requests).toHaveLength(1);
    expect(fake.children[0]?.requests[0]?.pids.sort()).toEqual([10, 11, 12]);
    await helper.close();
  });

  it("reuses a fresh snapshot only when it covers the request", async () => {
    let time = 1000;
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn, now: () => time });
    await helper.query([10]);
    await helper.query([10], false, 500);
    expect(fake.children[0]?.requests).toHaveLength(1);
    await helper.query([11], false, 500);
    expect(fake.children[0]?.requests).toHaveLength(2);
    time += 600;
    await helper.query([11], false, 500);
    expect(fake.children[0]?.requests).toHaveLength(3);
    await helper.query([], true);
    await helper.query([12], false, 500);
    expect(fake.children[0]?.requests).toHaveLength(4);
    await helper.close();
  });

  it("restarts after the helper dies and repeats the request", async () => {
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    await helper.query([10]);
    fake.children[0]?.die();
    await expect(helper.query([11])).resolves.toHaveLength(1);
    expect(helper.starts).toBe(2);
    expect(fake.children).toHaveLength(2);
    await helper.close();
  });

  it("retries once when the helper dies mid-request, then fails", async () => {
    const fake = fakeHelper(table, { mute: true });
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    const pending = helper.query([10]);
    const failure = expect(pending).rejects.toThrow("exited unexpectedly");
    await vi.waitFor(() => expect(fake.children).toHaveLength(1));
    await vi.waitFor(() => expect(fake.children[0]?.requests).toHaveLength(1));
    fake.children[0]?.die();
    await vi.waitFor(() => expect(fake.children).toHaveLength(2));
    await vi.waitFor(() => expect(fake.children[1]?.requests).toHaveLength(1));
    fake.children[1]?.die();
    await failure;
    await helper.close();
  });

  it("names the option when the helper stops answering", async () => {
    const fake = fakeHelper(table, { mute: true });
    const helper = new WindowsProcessHelper({ spawn: fake.spawn, timeoutMs: 30 });
    await expect(helper.query([10])).rejects.toThrow(/observationTimeoutMs/);
    expect(fake.children.every((child) => child.killed)).toBe(true);
    await helper.close();
  });

  it("surfaces an error reply", async () => {
    const fake = fakeHelper(table, { error: "Cannot read process creation time" });
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    await expect(helper.query([10])).rejects.toThrow("Cannot read process creation time");
    await helper.close();
  });

  it("shuts down with the supervisor: kills the child and rejects later queries", async () => {
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    await helper.query([10]);
    await helper.close();
    expect(fake.children[0]?.killed).toBe(true);
    await expect(helper.query([10])).rejects.toThrow("closed");
    await helper.close();
  });

  it("ships the script as an encoded command without quoting hazards", () => {
    const args = helperArguments();
    expect(args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive"]);
    expect(args[3]).toBe("-EncodedCommand");
    expect(Buffer.from(args[4] ?? "", "base64").toString("utf16le")).toBe(helperScript);
  });
});

describe("windows identity through the helper", () => {
  it("costs one query for N supervised PIDs per poll", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    const pids = [10, 11, 12];
    const results = await Promise.all(
      pids.map((pid) => identity(pid, true, "a".repeat(64), { helper, maxAgeMs: 1500 })),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(results[0]?.rss).toBe(150);
    expect(fake.children[0]?.requests).toHaveLength(1);
    await helper.close();
  });

  it("costs at most two queries without a cache window", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const fake = fakeHelper(table);
    const helper = new WindowsProcessHelper({ spawn: fake.spawn });
    await Promise.all([10, 11, 12].map((pid) => identity(pid, true, "a".repeat(64), { helper })));
    expect(fake.children[0]?.requests.length).toBeLessThanOrEqual(2);
    await helper.close();
  });
});
