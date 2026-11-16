import { createJsonRpcClient } from "@warlock.js/ai-tools";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { command } from "../commands/cli-command";
import { resetHttpReadyReport, setHttpReadyReport } from "../http/ready-report";
import { readDevServerState } from "../tooling/dev-state/dev-server-state";
import { withMcpTools } from "../tooling/mcp/mcp-tool-registry";
import { inputSchema } from "../tooling/mcp/tool-input";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { DevAgentTooling } from "./dev-agent-tooling";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  resetHttpReadyReport();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("warlock dev --mcp with registered tools", () => {
  it("serves the tools a cli.commands entry carries", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "warlock-dev-mcp-tools-"));

    roots.push(cwd);

    const scry = withMcpTools(command({ name: "acme.scry", action: () => undefined }), [
      {
        name: "acme_scry",
        description: "Answer a question about the app. Read-only.",
        input: inputSchema({ q: { type: "string", description: "The question." } }, ["q"]),
        writes: false,
        run: async (input) => ({ answer: `about ${String(input.q)}` }),
      },
    ]);

    vi.spyOn(warlockConfigManager, "isLoaded", "get").mockReturnValue(true);
    vi.spyOn(warlockConfigManager, "load").mockResolvedValue({ cli: { commands: [scry] } });

    setHttpReadyReport({
      url: "http://localhost:2998",
      wildcardBind: false,
      port: 2998,
      routeCount: 0,
    });

    const tooling = new DevAgentTooling(cwd);

    await tooling.start({ agentsMd: false, mcp: { port: 0, allowWrites: false } });

    const client = createJsonRpcClient({
      type: "http",
      url: readDevServerState(cwd)?.mcp?.url ?? "",
    });

    try {
      await client.call("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "spec", version: "1" },
      });

      const result = await client.call<{ content: { text: string }[]; isError: boolean }>(
        "tools/call",
        { name: "acme_scry", arguments: { q: "posts" } },
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({ answer: "about posts" });
    } finally {
      await client.close();
      await tooling.shutdown();
    }
  });
});
