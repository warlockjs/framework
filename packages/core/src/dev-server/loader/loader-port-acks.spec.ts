import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { trackLoaderPortAcks } from "./loader-port-acks";

/**
 * the main-thread end of the loader-hook channel kept the process alive
 * after the HTTP test server stopped, so Vitest's main process hung until its
 * close timeout. The port must stay unreferenced except while a `sync` waits.
 */
describe("trackLoaderPortAcks", () => {
  const channels: MessageChannel[] = [];

  afterEach(() => {
    for (const channel of channels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
    }
  });

  function channel() {
    const created = new MessageChannel();
    channels.push(created);
    return created;
  }

  it("leaves the port unreferenced once the listener is attached", () => {
    const { port1 } = channel();

    trackLoaderPortAcks(port1);

    expect(port1.hasRef()).toBe(false);
  });

  it("references the port only while a sync waits for its ack", async () => {
    const { port1, port2 } = channel();
    const acks = trackLoaderPortAcks(port1);

    port2.on("message", (message: { type: string }) => {
      if (message.type === "sync") port2.postMessage({ type: "sync-ack" });
    });

    const pending = acks.sync();

    expect(port1.hasRef()).toBe(true);

    await pending;

    expect(port1.hasRef()).toBe(false);
  });

  it("resolves concurrent syncs in order and stays referenced until the last ack", async () => {
    const { port1, port2 } = channel();
    const acks = trackLoaderPortAcks(port1);
    const order: number[] = [];

    const first = acks.sync().then(() => order.push(1));
    const second = acks.sync().then(() => order.push(2));

    // Answer the first sync only.
    port2.postMessage({ type: "sync-ack" });
    await first;

    expect(order).toEqual([1]);
    expect(port1.hasRef()).toBe(true);

    port2.postMessage({ type: "sync-ack" });
    await second;

    expect(order).toEqual([1, 2]);
    expect(port1.hasRef()).toBe(false);
  });

  it("ignores messages other than sync-ack", async () => {
    const { port1, port2 } = channel();
    const acks = trackLoaderPortAcks(port1);
    let settled = false;

    void acks.sync().then(() => {
      settled = true;
    });

    port2.postMessage({ type: "bump" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(settled).toBe(false);
    expect(port1.hasRef()).toBe(true);

    port2.postMessage({ type: "sync-ack" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(settled).toBe(true);
  });

  it("releases pending sync references and listeners on dispose", async () => {
    const { port1 } = channel();
    const acks = trackLoaderPortAcks(port1);
    const pending = acks.sync();
    expect(port1.hasRef()).toBe(true);
    acks.dispose();
    await pending;
    expect(port1.hasRef()).toBe(false);
    expect(port1.listenerCount("message")).toBe(0);
    await acks.sync();
    acks.dispose();
  });

  it("lets a process exit after disposing a loader channel with a pending sync", () => {
    // The real failure: nothing else is pending, yet the process never exits.
    // Resolved from the package root (vitest's cwd); core's tsconfig module
    // setting does not allow `import.meta` here.
    const moduleUrl = pathToFileURL(path.resolve("src/dev-server/loader/loader-port-acks.ts")).href;
    const source = [
      'import { MessageChannel } from "node:worker_threads";',
      `const { trackLoaderPortAcks } = await import(${JSON.stringify(moduleUrl)});`,
      "const { port1, port2 } = new MessageChannel();",
      "const acks = trackLoaderPortAcks(port1);",
      "void acks.sync();",
      "acks.dispose();",
      "port2.unref();",
      'console.log("ready");',
    ].join("\n");

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      { encoding: "utf8", timeout: 15_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ready");
  }, 20_000);
});
