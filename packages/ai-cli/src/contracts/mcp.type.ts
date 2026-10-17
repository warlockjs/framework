/**
 * An MCP server started by the CLI as a child process (stdio transport).
 * `env` values usually hold tokens — they are written only into a 0600
 * config file inside the run's private directory, never into argv.
 */
export type CliMcpStdioServer = {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * A remote MCP server (streamable HTTP, or the older SSE transport).
 * `headers` usually hold an `Authorization` token — written only into the
 * run's 0600 config file, never into argv.
 */
export type CliMcpRemoteServer = {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
};

/** One MCP server, in the vendor-neutral shape every adapter renders to its own config format. */
export type CliMcpServer = CliMcpStdioServer | CliMcpRemoteServer;

/** MCP servers for a run, keyed by the server name the CLI will show. */
export type CliMcpServers = Record<string, CliMcpServer>;
