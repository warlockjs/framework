import { command } from "../../commands/cli-command";
import { logsCommandAction } from "./logs/logs-command.action";

/**
 * `warlock logs requests` lists the requests the persistent request log
 * (`http.logging.requests`) wrote; `warlock logs request <id>` prints one in
 * full: the error, its log entries, queries and phases.
 *
 * No preload: it reads `storage/logs/requests/*.jsonl` from the current
 * directory and boots nothing, so it works on a stopped app and on a server
 * that only has the logs.
 */
export const logsCommand = command({
  name: "logs <action> [id]",
  description:
    "Read the persistent request log: `logs requests` lists requests (filter with --status / --route / --since / --limit), `logs request <id>` prints one; --json for the data",
  action: logsCommandAction,
  options: [
    {
      text: "--status",
      description: "Only this status (404) or class (5xx)",
      type: "string",
    },
    {
      text: "--route",
      description: "Only routes whose name or pattern contains this text",
      type: "string",
    },
    {
      text: "--since",
      description: "Only requests since a duration back (30m, 1h, 2d) or an ISO date",
      type: "string",
    },
    {
      text: "--limit, -n",
      description: "How many requests to list (default 50, newest first)",
      type: "string",
    },
    {
      text: "--json, -j",
      description: "Print JSON instead of text",
      type: "boolean",
    },
  ],
});
