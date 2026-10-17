// Run by react-dom-server-runtimes.spec.ts under Bun and Deno (never imported by
// vitest): stream a small React tree through the same loader the page renderer
// uses and print the HTML, so the spec sees what that runtime really produces.
//
// With `--condition-selected` it only reports whether the module the runtime
// picks for a bare `react-dom/server` import has `renderToPipeableStream` —
// the control that shows why the loader exists.
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { loadStreamingReactDomServer } from "../../../src/server/load-react-dom-server.ts";

if (process.argv.includes("--condition-selected")) {
  const selected = await import("react-dom/server");
  const hasRenderToPipeableStream = typeof selected.renderToPipeableStream === "function";

  process.stdout.write(JSON.stringify({ hasRenderToPipeableStream }), () => process.exit(0));
} else {
  const { renderToPipeableStream } = await loadStreamingReactDomServer();
  const sink = new PassThrough();
  const chunks = [];

  sink.on("data", (chunk) => chunks.push(chunk));
  sink.on("end", () => {
    const html = Buffer.concat(chunks).toString("utf8");

    // Exit explicitly: Deno keeps the process alive after the stream ends.
    process.stdout.write(JSON.stringify({ html }), () => process.exit(0));
  });

  const stream = renderToPipeableStream(createElement("p", { id: "marker" }, "streamed"), {
    onAllReady: () => stream.pipe(sink),
    onShellError: (error) => {
      console.error(error);
      process.exit(1);
    },
  });
}
