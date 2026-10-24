---
title: "warlock logs"
description: Read the persistent request log from the terminal — list requests by status, route and time, or open one with its error, log entries, queries and phases.
sidebar:
  order: 14
  label: "warlock logs"
---

`warlock logs` reads the [request log](/v/latest/core/digging-deeper/request-log/) (`http.logging.requests`): the JSON-lines files in `storage/logs/requests`. Nothing boots, so it works on a stopped app, on a server that only has the files, and from CI artifacts.

```bash
warlock logs requests
warlock logs requests --status 5xx --since 1h
warlock logs requests --status 404 --route posts --limit 20 --json
warlock logs request f3c1d0a2 --json
```

Run it from the project root: it reads `storage/logs/requests` under the current directory.

## `warlock logs requests`

Lists persisted requests, newest first: time, status, method, duration, URL, id, and the error message when there is one.

| Flag          | Type    | Description                                                                             |
| ------------- | ------- | --------------------------------------------------------------------------------------- |
| `--status`    | string  | One status (`404`) or a class (`5xx`).                                                  |
| `--route`     | string  | Routes whose name or pattern contains this text (`posts.list`, `/users`).               |
| `--since`     | string  | A duration back from now (`30m`, `1h`, `2d`, `1w`) or an ISO date.                      |
| `--limit, -n` | string  | How many rows. Default 50.                                                              |
| `--json, -j`  | boolean | Print the rows as JSON.                                                                 |

## `warlock logs request <id>`

Prints one record: method, URL, status and time, the route and user, the **error** with its stack (and phase, page file and site), the phases, the query count with the slowest query and N+1 findings, the log entries the request emitted, and the redacted body. `--json` prints the whole [`RequestLogRecord`](/v/latest/core/digging-deeper/request-log/).

## Exit codes

`0` on success (including an empty list), `1` for a bad flag value, an unknown id or an unknown action. With `--json`, a failure prints `{ "ok": false, "message": "…" }`.

## Related

- [Request log](/v/latest/core/digging-deeper/request-log/) — what is recorded and how to configure it.
- [`warlock trace`](./trace.md) — send one request to the dev server and print its timeline.
- [MCP](./mcp.md) — the `request_log` tool gives agents the same data.
