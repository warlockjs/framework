/**
 * The child process of the stdio round-trip spec: serves the fixture context
 * over stdio exactly as `warlock mcp` does, and exits when stdin closes.
 */
import { startWarlockMcpServer } from "../start-mcp-server";
import { fakeMcpContext } from "./fake-mcp-context";

async function main(): Promise<void> {
  const { context } = fakeMcpContext();
  const server = await startWarlockMcpServer({ context, transport: { type: "stdio" } });

  process.stdin.once("end", () => {
    void server.close().then(() => process.exit(0));
  });
}

void main();
