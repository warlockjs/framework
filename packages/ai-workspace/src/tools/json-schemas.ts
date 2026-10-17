import type { JsonSchemaObject } from "./schema";

/**
 * The JSON Schemas the workspace tools publish for their input (read by
 * `extractJsonSchema` and sent to the provider with each tool), kept short
 * because they ride along on every model call. They describe what the
 * hand-rolled validators accept; the validators remain the authority.
 */

const string = (description: string): JsonSchemaObject => ({ type: "string", description });
const integer = (description: string): JsonSchemaObject => ({ type: "integer", description });
const boolean = (description: string): JsonSchemaObject => ({ type: "boolean", description });

/** `read_file`. */
export const READ_FILE_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    path: string("Workspace-relative file path."),
    startLine: integer("1-based first line to return."),
    limit: integer("Most lines to return."),
  },
  required: ["path"],
};

/** `edit_file`. */
export const EDIT_FILE_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    path: string("Workspace-relative file path."),
    oldString: string("Exact text to replace; must be unique unless replaceAll."),
    newString: string("Replacement text."),
    replaceAll: boolean("Replace every occurrence."),
    expectHash: string("Hash from read_file; rejects the edit if the file changed."),
  },
  required: ["path", "oldString", "newString"],
};

/** `multi_edit`. */
export const MULTI_EDIT_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    path: string("Workspace-relative file path."),
    edits: {
      type: "array",
      description:
        "Replacements applied in order, each to the result of the previous; all or none.",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          oldString: string("Exact text to replace; must be unique unless replaceAll."),
          newString: string("Replacement text."),
          replaceAll: boolean("Replace every occurrence."),
        },
        required: ["oldString", "newString"],
      },
    },
    expectHash: string("Hash from read_file; rejects every edit if the file changed."),
  },
  required: ["path", "edits"],
};

/** `write_file`. */
export const WRITE_FILE_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    path: string("Workspace-relative file path."),
    content: string("Full file content."),
  },
  required: ["path", "content"],
};

/** `list_dir`. */
export const LIST_DIR_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    path: string('Workspace-relative directory (default ".").'),
    depth: integer("Levels to list; 1 = direct children (default)."),
    ignore: { type: "array", items: { type: "string" }, description: "Extra globs to leave out." },
  },
};

/** `run_shell` (the `background` property is only listed when background commands are enabled). */
export function runShellJsonSchema(background: boolean): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      command: string("The command line to run."),
      timeoutMs: integer("Wall-clock cap in ms (can only lower the workspace limit)."),
      ...(background
        ? {
            background: boolean(
              "Start it in the background and return its id at once (dev servers, watchers).",
            ),
          }
        : {}),
    },
    required: ["command"],
  };
}

/** `shell_output`. */
export const SHELL_OUTPUT_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    id: string("Background command id from run_shell."),
    since: integer("A cursor from an earlier result; omit for output since the last read."),
    waitMs: integer("Wait up to this long (max 30000) for new output."),
  },
  required: ["id"],
};

/** `shell_kill`. */
export const SHELL_KILL_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: { id: string("Background command id from run_shell.") },
  required: ["id"],
};

/** `run_tests`. */
export const RUN_TESTS_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: { pattern: string("Optional test path or name filter.") },
};

/** `grep`. */
export const GREP_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    pattern: string("Regular expression to search for."),
    glob: string('Only search files matching this glob (e.g. "src/**/*.ts").'),
    ignoreCase: boolean("Case-insensitive match."),
  },
  required: ["pattern"],
};

/** `glob`. */
export const GLOB_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: { pattern: string('Glob such as "src/**/*.ts".') },
  required: ["pattern"],
};

/** `todo_write`. */
export const TODO_WRITE_JSON_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      description: "The complete updated list (replaces the old one).",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          id: string("Stable id; omit to number items by position."),
          content: string("The step."),
          status: { type: "string", enum: ["pending", "in_progress", "completed"] },
        },
        required: ["content", "status"],
      },
    },
  },
  required: ["todos"],
};

/** `todo_read`. */
export const TODO_READ_JSON_SCHEMA: JsonSchemaObject = { type: "object", properties: {} };
