import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { streamReactResponse, type PipeableReactStream } from "./stream-react-response";

/**
 * A minimal stand-in for Node's `ServerResponse` — an `EventEmitter` plus the
 * handful of members `streamReactResponse` touches. Real enough to drive
 * "close"/"finish"/"error" the way the real socket would, without a real
 * HTTP server.
 */
class FakeRawResponse extends EventEmitter {
  public writeHead = vi.fn();
  public writableEnded = false;

  public finish(): void {
    this.writableEnded = true;
    this.emit("finish");
  }
}

function fakePipeableStream(): PipeableReactStream & { pipe: ReturnType<typeof vi.fn> } {
  return {
    pipe: vi.fn((destination) => destination),
    abort: vi.fn(),
  };
}

describe("streamReactResponse", () => {
  it("writes the committed status and headers before piping", async () => {
    const raw = new FakeRawResponse();
    const pipeableStream = fakePipeableStream();

    const pending = streamReactResponse({
      raw: raw as never,
      statusCode: 201,
      headers: { "content-type": "text/html", "x-custom": "1" },
      pipeableStream,
    });

    expect(raw.writeHead).toHaveBeenCalledWith(201, {
      "content-type": "text/html",
      "x-custom": "1",
    });
    expect(pipeableStream.pipe).toHaveBeenCalledWith(raw);
    // `writeHead` must land before `pipe` starts writing bytes — assert call order.
    expect(raw.writeHead.mock.invocationCallOrder[0]).toBeLessThan(
      pipeableStream.pipe.mock.invocationCallOrder[0],
    );

    raw.finish();
    await pending;
  });

  it("resolves once the raw response finishes", async () => {
    const raw = new FakeRawResponse();
    const pipeableStream = fakePipeableStream();

    const pending = streamReactResponse({
      raw: raw as never,
      statusCode: 200,
      headers: {},
      pipeableStream,
    });

    let resolved = false;
    pending.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    raw.finish();
    await pending;

    expect(resolved).toBe(true);
  });

  it("aborts the React render when the client disconnects before the stream finishes", async () => {
    const raw = new FakeRawResponse();
    const pipeableStream = fakePipeableStream();

    const pending = streamReactResponse({
      raw: raw as never,
      statusCode: 200,
      headers: {},
      pipeableStream,
    });

    raw.emit("close");

    expect(pipeableStream.abort).toHaveBeenCalledTimes(1);

    // Unblock the pending promise so the test does not leak a dangling handler.
    raw.finish();
    await pending;
  });

  it("does not abort a React render that already finished normally", async () => {
    const raw = new FakeRawResponse();
    const pipeableStream = fakePipeableStream();

    const pending = streamReactResponse({
      raw: raw as never,
      statusCode: 200,
      headers: {},
      pipeableStream,
    });

    raw.finish();
    await pending;

    // Node also fires "close" after "finish" on an ordinary completed response.
    raw.emit("close");

    expect(pipeableStream.abort).not.toHaveBeenCalled();
  });

  it("rejects when the raw response errors", async () => {
    const raw = new FakeRawResponse();
    const pipeableStream = fakePipeableStream();
    const failure = new Error("socket blew up");

    const pending = streamReactResponse({
      raw: raw as never,
      statusCode: 200,
      headers: {},
      pipeableStream,
    });

    raw.emit("error", failure);

    await expect(pending).rejects.toBe(failure);
  });
});
