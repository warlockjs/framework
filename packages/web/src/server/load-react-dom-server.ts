import type { renderToPipeableStream } from "react-dom/server";

/** The part of `react-dom/server` the streaming page renderer needs. */
export type StreamingReactDomServer = {
  renderToPipeableStream: typeof renderToPipeableStream;
};

/**
 * Load the `react-dom/server` build that has `renderToPipeableStream`.
 *
 * `react-dom/server` picks its build through package export conditions, and
 * the runtime decides which condition wins (react-dom 19's `exports["./server"]`):
 * Node takes `"node"` → `server.node.js`, but Bun takes `"bun"` →
 * `server.bun.js` and Deno takes `"deno"` → `server.browser.js`. Neither of
 * those two builds exports `renderToPipeableStream` — they ship only the
 * web-streams API — so a page render on Bun or Deno failed with
 * "renderToPipeableStream is not a function".
 *
 * The page renderer writes into Node streams, and both runtimes implement the
 * Node stream, `util` and `async_hooks` APIs the Node build relies on, so the
 * fix is to load that build explicitly (`react-dom/server.node`, a public
 * subpath export) when the condition-selected module lacks the function. On
 * Node the condition-selected module already has it and is returned as is.
 */
export async function loadStreamingReactDomServer(): Promise<StreamingReactDomServer> {
  return pickStreamingReactDomServer(
    await import("react-dom/server"),
    () => import("react-dom/server.node"),
  );
}

/**
 * The decision {@link loadStreamingReactDomServer} makes, apart from the
 * imports: keep the condition-selected module when it can stream, otherwise
 * load the Node build. Separate so it can be tested without a module mock —
 * under vitest both specifiers resolve to the same `server.node.js` file.
 */
export async function pickStreamingReactDomServer(
  selected: Partial<StreamingReactDomServer>,
  loadNodeBuild: () => Promise<StreamingReactDomServer>,
): Promise<StreamingReactDomServer> {
  const { renderToPipeableStream } = selected;

  if (typeof renderToPipeableStream === "function") {
    return { renderToPipeableStream };
  }

  return loadNodeBuild();
}
