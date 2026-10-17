import { command } from "../../commands/cli-command";
import { traceCommandAction } from "./trace/trace-command.action";

/**
 * `warlock trace <method> <url>` — send one request to the running dev server
 * and print its devtools timeline: middleware, validation result, handler,
 * queries with N+1 flags, logs, cache operations, the response and timings.
 * `--json` prints the versioned report (`schemaVersion: 1`).
 *
 * No preload: nothing boots here. The dev server (`warlock dev` with
 * `@warlock.js/devtools` installed) does the work; this command finds it
 * through `.warlock/dev-server.json` or `--url`.
 */
export const traceCommand = command({
  name: "trace <method> <url>",
  description:
    "Send a request to the running dev server and print its devtools timeline (middleware, validation, queries, logs, response, timings); --json for the report",
  action: traceCommandAction,
  options: [
    {
      text: "--body, -b",
      description: "Request body: JSON text, plain text, or @file to read it from a file",
      type: "string",
    },
    {
      text: "--header, -H",
      description: "A request header as name:value (repeatable)",
      type: "string",
    },
    {
      text: "--url, -u",
      description: "Dev server origin (default: read from .warlock/dev-server.json)",
      type: "string",
    },
    {
      text: "--devtools-path",
      description: "Devtools mount path (default /__warlock)",
      type: "string",
    },
    {
      text: "--id-header",
      description: "The app's request id header (http.requestId.header; default x-request-id)",
      type: "string",
    },
    {
      text: "--timeout, -t",
      description: "How long to wait for the devtools record, in ms (default 5000)",
      type: "string",
    },
    {
      text: "--json, -j",
      description: "Print the trace report as JSON (schemaVersion 1)",
      type: "boolean",
    },
  ],
});
