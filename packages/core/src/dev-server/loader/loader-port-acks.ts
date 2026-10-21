import type { MessagePort } from "node:worker_threads";

export type LoaderPortAcks = {
  /**
   * Post a `sync` message and resolve once the hook thread answers with
   * `sync-ack`. Every message posted before it has been processed by then.
   */
  sync(): Promise<void>;
  dispose(): void;
};

/**
 * Wire the main-thread end of the loader-hook channel so it never keeps the
 * process alive on its own.
 *
 * A `message` listener refs a `MessagePort`, and the hook thread lives for the
 * whole process, so a referenced port holds the event loop open after
 * everything else has closed: the HTTP test server's teardown finished, yet
 * Vitest's main process could not exit. The port is unreferenced as
 * soon as the listener is attached and referenced again only while a `sync`
 * waits for its acknowledgement, so a pending flush still completes.
 *
 * Acks arrive in the order the syncs were posted, so the waiters form a queue.
 */
export function trackLoaderPortAcks(port: MessagePort): LoaderPortAcks {
  const waiters: Array<() => void> = [];

  let disposed = false;
  const onMessage = (message: { type?: string }) => {
    if (message?.type !== "sync-ack") return;

    waiters.shift()?.();

    if (waiters.length === 0) port.unref();
  };
  port.on("message", onMessage);

  port.unref();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      port.off("message", onMessage);
      for (const resolve of waiters.splice(0)) resolve();
      port.close();
    },
    sync() {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        port.ref();
        port.postMessage({ type: "sync" });
      });
    },
  };
}
