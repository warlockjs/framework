import { command } from "../../commands/cli-command";
import { boardCommandAction } from "./board/board-command.action";

/**
 * `warlock board <action>` — the agent board: work items and append-only
 * messages two coding agents (an implementer and a reviewer) share in the
 * git-ignored `.warlock/board/` folder.
 *
 * Actions: `init`, `add <title>`, `status [id] [state]`, `send <agent>
 * <subject>`, `watch <agent>`. No preload: it reads and writes files only.
 */
export const boardCommand = command({
  name: "board <action> [args...]",
  description:
    "Agent board: init | add <title> | status [id] [state] | send <agent> <subject> | watch <agent> (items and messages in .warlock/board/)",
  action: boardCommandAction,
  options: [
    {
      text: "--json, -j",
      description: "Print one JSON object (stdout carries only the JSON)",
      type: "boolean",
    },
    {
      text: "--assignee",
      description: "add: the agent doing the work",
      type: "string",
    },
    {
      text: "--reviewer",
      description: "add: the agent reviewing it",
      type: "string",
    },
    {
      text: "--by",
      description: "add, status: the agent making the change (default: WARLOCK_AGENT)",
      type: "string",
    },
    {
      text: "--note",
      description: "status <id> <state>: why the item moved",
      type: "string",
    },
    {
      text: "--from",
      description: "send: the sending agent (default: WARLOCK_AGENT)",
      type: "string",
    },
    {
      text: "--item",
      description: "send: the item id the message is about",
      type: "string",
    },
    {
      text: "--body",
      description: "send: the message body, or @file to read it from a file",
      type: "string",
    },
    {
      text: "--verdict",
      description: "send: approved | changes-requested (also moves --item to that state)",
      type: "string",
    },
    {
      text: "--timeout",
      description: "watch: seconds to wait before giving up with exit code 3 (default 600)",
      type: "string",
    },
    {
      text: "--since",
      description: "watch: return messages numbered above N (default: the agent's cursor)",
      type: "string",
    },
  ],
});
