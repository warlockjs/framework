import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNodeOnlyCommand,
  describeJavaScriptRuntime,
  detectJavaScriptRuntime,
  nodeOnlyCommandError,
  SUPPORTED_RUNTIMES_DOCS_URL,
  unverifiedBuildRuntimeNotice,
} from "./runtime";

// This suite runs on Node, so the live `process.versions` has no bun/deno entry.
const nodeVersions: NodeJS.ProcessVersions = { ...process.versions, node: "22.15.0" };
const bunVersions: NodeJS.ProcessVersions = { ...process.versions, node: "24.3.0", bun: "1.4.3" };
const denoVersions: NodeJS.ProcessVersions = { ...process.versions, node: "24.2.0", deno: "2.9.7" };

describe("detectJavaScriptRuntime", () => {
  it("reports Node when neither Bun nor Deno announces itself", () => {
    expect(detectJavaScriptRuntime(nodeVersions)).toEqual({ type: "node", version: "22.15.0" });
  });

  it("reports Bun with Bun's own version, not the emulated Node version", () => {
    expect(detectJavaScriptRuntime(bunVersions)).toEqual({ type: "bun", version: "1.4.3" });
  });

  it("reports Deno with Deno's own version, not the emulated Node version", () => {
    expect(detectJavaScriptRuntime(denoVersions)).toEqual({ type: "deno", version: "2.9.7" });
  });

  it("reads the live process by default (this suite runs on Node)", () => {
    expect(detectJavaScriptRuntime()).toEqual({ type: "node", version: process.versions.node });
  });

  it("names the runtime for messages", () => {
    expect(describeJavaScriptRuntime({ type: "bun", version: "1.4.3" })).toBe("Bun 1.4.3");
    expect(describeJavaScriptRuntime({ type: "deno", version: "2.9.7" })).toBe("Deno 2.9.7");
    expect(describeJavaScriptRuntime({ type: "node", version: "22.15.0" })).toBe("Node.js 22.15.0");
  });
});

describe("nodeOnlyCommandError", () => {
  it("allows the command on Node", () => {
    expect(nodeOnlyCommandError("dev", { type: "node", version: "22.15.0" })).toBeUndefined();
  });

  it("explains the refusal on Bun and points at the production start command", () => {
    const message = nodeOnlyCommandError("dev", { type: "bun", version: "1.4.3" });

    expect(message).toContain("warlock dev runs on Node.js only — this process is Bun 1.4.3.");
    expect(message).toContain("npx warlock dev");
    expect(message).toContain("bun dist/app.js");
    expect(message).toContain(SUPPORTED_RUNTIMES_DOCS_URL);
  });

  it("explains the refusal on Deno and points at the production start command", () => {
    const message = nodeOnlyCommandError("dev", { type: "deno", version: "2.9.7" });

    expect(message).toContain("this process is Deno 2.9.7.");
    expect(message).toContain("deno run -A dist/app.js");
  });
});

describe("assertNodeOnlyCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing on Node", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    assertNodeOnlyCommand("dev", { type: "node", version: "22.15.0" });

    expect(exit).not.toHaveBeenCalled();
  });

  it("prints the error on stderr and exits 1 on Bun or Deno", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    assertNodeOnlyCommand("dev", { type: "deno", version: "2.9.7" });

    expect(error).toHaveBeenCalledWith(
      nodeOnlyCommandError("dev", { type: "deno", version: "2.9.7" }),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("unverifiedBuildRuntimeNotice", () => {
  it("is silent on Node", () => {
    expect(unverifiedBuildRuntimeNotice({ type: "node", version: "22.15.0" })).toBeUndefined();
  });

  it("notes that only the Node build is verified, without refusing", () => {
    const notice = unverifiedBuildRuntimeNotice({ type: "bun", version: "1.4.3" });

    expect(notice).toContain("warlock build is verified on Node.js; this process is Bun 1.4.3.");
    expect(notice).toContain("Starting the built app on Bun is supported.");
  });
});
