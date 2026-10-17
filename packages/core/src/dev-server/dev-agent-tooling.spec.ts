import { createJsonRpcClient } from "@warlock.js/ai-tools";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mcpTransportFromOptions } from "../cli/commands/mcp/mcp-command.action";
import {
  readDevServerState,
  removeDevServerState,
  updateDevServerState,
  writeDevServerState,
} from "../tooling/dev-state/dev-server-state";
import { resetHttpReadyReport, setHttpReadyReport } from "../http/ready-report";
import { DevAgentTooling, resolveDevMcpOptions } from "./dev-agent-tooling";

const roots: string[] = [];

afterEach(() => {
  resetHttpReadyReport();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-dev-state-"));

  roots.push(root);

  return root;
}

describe("dev server state file", () => {
  it("round-trips, merges updates, and is removed only by its own process", () => {
    const cwd = project();

    expect(readDevServerState(cwd)).toBeUndefined();

    writeDevServerState(
      {
        schemaVersion: 1,
        pid: 4242,
        url: "http://localhost:2030",
        startedAt: "2026-01-01T00:00:00.000Z",
        devtools: { path: "/__warlock" },
        mcp: null,
      },
      cwd,
    );
    updateDevServerState({ mcp: { url: "http://127.0.0.1:5000/mcp" } }, cwd);

    expect(readDevServerState(cwd)).toMatchObject({
      pid: 4242,
      url: "http://localhost:2030",
      devtools: { path: "/__warlock" },
      mcp: { url: "http://127.0.0.1:5000/mcp" },
    });

    removeDevServerState(1, cwd);
    expect(readDevServerState(cwd)).toBeDefined();

    removeDevServerState(4242, cwd);
    expect(readDevServerState(cwd)).toBeUndefined();
  });
});

describe("dev --mcp options", () => {
  it("is off unless the flag or config turns it on", () => {
    expect(resolveDevMcpOptions(undefined, undefined)).toBe(false);
    expect(resolveDevMcpOptions(undefined, false)).toBe(false);
    expect(resolveDevMcpOptions(true, undefined)).toEqual({ port: 0, allowWrites: false });
    expect(resolveDevMcpOptions(undefined, { port: 7000, token: "t", allowWrites: true })).toEqual({
      port: 7000,
      token: "t",
      allowWrites: true,
    });
  });
});

describe("warlock mcp transport options", () => {
  it("defaults to stdio and reads HTTP options and the token env variable", () => {
    expect(mcpTransportFromOptions({})).toEqual({ type: "stdio" });
    expect(mcpTransportFromOptions({ http: true }, { WARLOCK_MCP_TOKEN: "env-token" })).toEqual({
      type: "http",
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      token: "env-token",
    });
    expect(mcpTransportFromOptions({ port: "7001", token: "x" }, {})).toMatchObject({
      type: "http",
      port: 7001,
      token: "x",
    });
    expect(() => mcpTransportFromOptions({ http: true, port: "abc" }, {})).toThrow(/--port/);
  });
});

describe("DevAgentTooling", () => {
  it("records the server, serves MCP from the dev process, and cleans up on shutdown", async () => {
    const cwd = project();
    const tooling = new DevAgentTooling(cwd);

    setHttpReadyReport({
      url: "http://localhost:2999",
      wildcardBind: false,
      port: 2999,
      routeCount: 0,
    });

    await tooling.start({
      agentsMd: false,
      mcp: { port: 0, token: "dev-token", allowWrites: false },
    });

    const state = readDevServerState(cwd);

    expect(state).toMatchObject({ pid: process.pid, url: "http://localhost:2999", devtools: null });
    expect(state?.mcp?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = createJsonRpcClient({
      type: "http",
      url: state?.mcp?.url ?? "",
      headers: { authorization: "Bearer dev-token" },
    });

    try {
      await client.call("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "spec", version: "1" },
      });

      const result = await client.call<{ content: { text: string }[]; isError: boolean }>(
        "tools/call",
        {
          name: "explain",
          arguments: { code: "WL8008" },
        },
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ code: "WL8008" });
    } finally {
      await client.close();
    }

    await tooling.shutdown();

    expect(readDevServerState(cwd)).toBeUndefined();
  });

  it("writes no state for a process without an HTTP server", async () => {
    const cwd = project();
    const tooling = new DevAgentTooling(cwd);

    await tooling.start({ agentsMd: false, mcp: false });

    expect(readDevServerState(cwd)).toBeUndefined();

    await tooling.shutdown();
  });
});
