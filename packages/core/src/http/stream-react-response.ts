import type { OutgoingHttpHeaders, ServerResponse } from "node:http";

/**
 * The subset of React's server `PipeableStream` (`react-dom/server`) this
 * helper needs — piping the render onto a Node writable and aborting it
 * early. Declared locally, structurally compatible with React's own type,
 * so this file carries no `react-dom` import: `@warlock.js/core` has no peer
 * dependency on React, only the caller that already imported
 * `renderToPipeableStream` does.
 */
export type PipeableReactStream = {
  pipe<Destination extends NodeJS.WritableStream>(destination: Destination): Destination;
  abort(reason?: unknown): void;
};

/** Options for {@link streamReactResponse}. */
export type StreamReactResponseOptions = {
  /** The raw Node response, obtained via core's `Response` — never handed to `web`. */
  raw: ServerResponse;
  /**
   * The committed HTTP status. Decided by the caller BEFORE this runs —
   * loaders, middleware short-circuits, validation and error escalation have
   * all already settled, so this is the one and only status this response
   * will carry.
   */
  statusCode: number;
  /**
   * The committed response headers, read once before piping starts.
   * `Set-Cookie` entries already committed via the framework's ordinary
   * cookie APIs are expected to already be present here (Fastify writes a
   * cookie to the header as soon as it is set), so this helper does not
   * take a separate cookie list.
   */
  headers: OutgoingHttpHeaders;
  /** The already-ready React server stream (its shell, or the whole tree, resolved by the caller). */
  pipeableStream: PipeableReactStream;
};

/**
 * Write the committed status/headers to the raw Node response and pipe a
 * React server stream onto it — the ONE place in the framework that turns a
 * `PipeableStream` into bytes on the wire (Stage 1 streaming SSR). `web`
 * never touches `raw` itself; it goes through this helper (or
 * `Response.streamReact`, which wraps it) exclusively.
 *
 * Aborts the React render when the client disconnects before the stream
 * finishes, so a dropped connection does not leave the render running to
 * completion for nobody.
 *
 * Resolves once the underlying response has finished sending. Rejects if the
 * raw response errors while writing.
 *
 * @example
 * ```ts
 * const pipeableStream = await new Promise<PipeableStream>((resolve, reject) => {
 *   const stream = renderToPipeableStream(element, {
 *     onShellReady: () => resolve(stream),
 *     onShellError: reject,
 *   });
 * });
 *
 * await streamReactResponse({ raw: response.raw, statusCode, headers, pipeableStream });
 * ```
 */
export function streamReactResponse(options: StreamReactResponseOptions): Promise<void> {
  const { raw, statusCode, headers, pipeableStream } = options;

  return new Promise<void>((resolve, reject) => {
    raw.writeHead(statusCode, headers);

    const onDisconnect = (): void => {
      // A normal completion also fires "close" after "finish" — aborting an
      // already-finished React stream is a documented no-op, but the
      // `writableEnded` guard keeps that fact from ever mattering here.
      if (raw.writableEnded) return;

      pipeableStream.abort();
    };

    raw.once("close", onDisconnect);
    raw.once("aborted", onDisconnect);

    raw.once("finish", () => resolve());
    raw.once("error", (error) => reject(error));

    pipeableStream.pipe(raw);
  });
}
