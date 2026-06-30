import { afterEach, describe, expect, it, vi } from "vitest";
import { SocketConnector } from "../../../src/connectors/socket-connector";
import { container } from "../../../src/container";

/**
 * Test subclass that exposes the protected lifecycle fields so a shutdown
 * test can put the connector into a "booted" state without standing up a real
 * Socket.IO server or a node HTTP server.
 */
class TestSocketConnector extends SocketConnector {
  public setActive(active: boolean): void {
    this.active = active;
  }

  public setOwnsRawServer(owns: boolean): void {
    this.ownsRawServer = owns;
  }
}

/** A socket.io double whose close() invokes its callback like the real one. */
const makeFakeSocket = () => {
  const close = vi.fn((cb?: () => void) => {
    cb?.();
  });

  return { close };
};

/** A node-server double whose close(cb) invokes the callback with no error. */
const makeFakeRawServer = () => {
  const close = vi.fn((cb?: (error?: Error) => void) => {
    cb?.();
  });

  return { close };
};

describe("SocketConnector — shutdown server ownership", () => {
  afterEach(() => {
    container.delete("socket");
    container.delete("socket.rawServer");
    vi.restoreAllMocks();
  });

  it("does NOT close the shared node server when http owns it (only closes the io layer)", async () => {
    const connector = new TestSocketConnector();
    const socket = makeFakeSocket();
    const rawServer = makeFakeRawServer();

    container.set("socket", socket as never);
    container.set("socket.rawServer", rawServer as never);

    connector.setActive(true);
    connector.setOwnsRawServer(false); // http owns the shared server

    await connector.shutdown();

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(rawServer.close).not.toHaveBeenCalled();
  });

  it("closes the node server when socket created it (http absent)", async () => {
    const connector = new TestSocketConnector();
    const socket = makeFakeSocket();
    const rawServer = makeFakeRawServer();

    container.set("socket", socket as never);
    container.set("socket.rawServer", rawServer as never);

    connector.setActive(true);
    connector.setOwnsRawServer(true); // socket created the server

    await connector.shutdown();

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(rawServer.close).toHaveBeenCalledTimes(1);
  });

  it("awaits the socket drain before resolving", async () => {
    const connector = new TestSocketConnector();
    const order: string[] = [];

    const socket = {
      // Defer the callback to a microtask so a non-awaited shutdown would
      // resolve before "drained" is pushed.
      close: vi.fn((cb?: () => void) => {
        Promise.resolve().then(() => {
          order.push("drained");
          cb?.();
        });
      }),
    };

    container.set("socket", socket as never);

    connector.setActive(true);
    connector.setOwnsRawServer(false);

    await connector.shutdown();
    order.push("shutdown-returned");

    expect(order).toEqual(["drained", "shutdown-returned"]);
  });

  it("is a no-op when the connector was never activated", async () => {
    const connector = new TestSocketConnector();
    const socket = makeFakeSocket();

    container.set("socket", socket as never);

    connector.setActive(false);

    await connector.shutdown();

    expect(socket.close).not.toHaveBeenCalled();
  });
});
