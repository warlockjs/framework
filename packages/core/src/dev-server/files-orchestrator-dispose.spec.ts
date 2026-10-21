import { once } from "node:events";
import { MessageChannel } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { FilesOrchestrator } from "./files-orchestrator";
import { FileManager } from "./file-manager";

it("runs module cleanup hooks that own referenced handles on test-server disposal", async () => {
  const orchestrator = new FilesOrchestrator();
  const channel = new MessageChannel();
  channel.port1.on("message", () => undefined);
  const cleanup = vi.fn(async () => {
    const closed = [once(channel.port1, "close"), once(channel.port2, "close")];
    channel.port1.close();
    channel.port2.close();
    await Promise.all(closed);
  });
  const file = new FileManager(
    "/tmp/src/app/example/main.ts",
    orchestrator.files,
    orchestrator.fileOperations,
  );
  file.addCleanup(cleanup);
  orchestrator.files.set(file.relativePath, file);
  try {
    expect(channel.port1.hasRef()).toBe(true);
    await orchestrator.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(channel.port1.hasRef()).toBe(false);
    expect(orchestrator.files.size).toBe(0);
    await orchestrator.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});
