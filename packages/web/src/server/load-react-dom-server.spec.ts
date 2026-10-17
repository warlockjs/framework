import { describe, expect, it, vi } from "vitest";
import {
  loadStreamingReactDomServer,
  pickStreamingReactDomServer,
  type StreamingReactDomServer,
} from "./load-react-dom-server";

describe("loadStreamingReactDomServer", () => {
  it("returns the condition-selected react-dom/server stream renderer on Node", async () => {
    const selected = await import("react-dom/server");

    const loaded = await loadStreamingReactDomServer();

    expect(loaded.renderToPipeableStream).toBe(selected.renderToPipeableStream);
  });
});

describe("pickStreamingReactDomServer", () => {
  it("keeps the selected module's renderer and never loads the Node build when it can stream", async () => {
    const renderToPipeableStream = vi.fn<StreamingReactDomServer["renderToPipeableStream"]>();
    const loadNodeBuild = vi.fn();

    const picked = await pickStreamingReactDomServer({ renderToPipeableStream }, loadNodeBuild);

    expect(picked.renderToPipeableStream).toBe(renderToPipeableStream);
    expect(loadNodeBuild).not.toHaveBeenCalled();
  });

  it("loads the Node build when the selected module has no renderToPipeableStream (Bun, Deno)", async () => {
    // What Bun ("bun" condition → server.bun.js) and Deno ("deno" condition →
    // server.browser.js) hand back for a bare `react-dom/server` import.
    const nodeBuild = await import("react-dom/server.node");
    const loadNodeBuild = vi.fn(async () => nodeBuild);

    const picked = await pickStreamingReactDomServer({}, loadNodeBuild);

    expect(loadNodeBuild).toHaveBeenCalledOnce();
    expect(picked.renderToPipeableStream).toBe(nodeBuild.renderToPipeableStream);
  });
});
