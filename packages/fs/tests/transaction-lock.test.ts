import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { hostname } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fs, type WriteDurability } from "../src/index";
import { withTempDir } from "./helpers";

const durability: WriteDurability = process.platform === "win32" ? "file" : "full";

describe("cooperating process writer ownership", () => {
  let root: string;
  let cleanup: () => Promise<void>;
  let child: ChildProcess | undefined;
  beforeEach(async () => {
    ({ dir: root, cleanup } = await withTempDir());
    await fs.openTransactions(root, { durability });
  });
  afterEach(async () => {
    // Only the exact child created by this test is stopped.
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    child = undefined;
    await cleanup();
  });

  async function owner(): Promise<ChildProcess> {
    const file = path.join(root, ".warlock-transactions", "writers", "child.json");
    child = spawn(
      process.execPath,
      [
        "-e",
        `
      const { writeFileSync } = require('node:fs');
      writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, host: process.argv[2], choosing: false, number: 1 }));
      process.send('ready');
      process.on('message', () => process.exit(0));
    `,
        file,
        hostname(),
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const started = child;
    await Promise.race([
      once(started, "message"),
      once(started, "exit").then(() => {
        throw new Error("Child exited before publishing ownership");
      }),
    ]);
    return started;
  }

  it("does not steal a live process ticket after a timeout", async () => {
    await owner();
    await expect(
      fs.transaction(
        root,
        async (tx) => {
          await tx.write("value", "no");
        },
        { durability, lockTimeoutMs: 25 },
      ),
    ).rejects.toMatchObject({ type: "lock-timeout" });
    await expect(readFile(path.join(root, "value"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes only the uniquely named dead ticket and allows the next writer", async () => {
    const started = await owner();
    const exited = once(started, "exit");
    started.send("exit");
    await exited;
    await fs.transaction(
      root,
      async (tx) => {
        await tx.write("value", "yes");
      },
      { durability },
    );
    expect(await readFile(path.join(root, "value"), "utf8")).toBe("yes");
  });

  it("fails closed on a foreign-host ticket", async () => {
    await writeFile(
      path.join(root, ".warlock-transactions", "writers", "foreign.json"),
      JSON.stringify({
        pid: process.pid,
        host: `${hostname()}-foreign`,
        choosing: false,
        number: 1,
      }),
    );
    await expect(fs.transaction(root, async () => undefined, { durability })).rejects.toMatchObject(
      { type: "invalid-journal" },
    );
  });
});
