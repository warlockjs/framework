import type { StandardSchemaV1 } from "@standard-schema/spec";
import { tool, type ToolContract } from "@warlock.js/ai";
import { MAX_TODOS, TODO_STATUSES, type TodoStore, todoListProblems } from "../todos";
import type {
  TodoListResult,
  TodoWriteInput,
  WorkspaceTodoInput,
  WorkspaceTodoStatus,
} from "../contracts";
import { TODO_READ_JSON_SCHEMA, TODO_WRITE_JSON_SCHEMA } from "./json-schemas";
import { withJsonSchema } from "./schema";

/** Whether `value` is a todo status. */
function isTodoStatus(value: unknown): value is WorkspaceTodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

/** Input schema for the `todo_write` tool. */
const todoWriteSchema = withJsonSchema<TodoWriteInput>(
  {
    "~standard": {
      version: 1,
      vendor: "ai-workspace",
      validate(value) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return { issues: [{ message: "input must be an object" }] };
        }

        const raw = (value as Record<string, unknown>).todos;

        if (!Array.isArray(raw) || raw.length > MAX_TODOS) {
          return {
            issues: [
              {
                message: `"todos" must be an array of at most ${MAX_TODOS} items`,
                path: ["todos"],
              },
            ],
          };
        }

        const issues: StandardSchemaV1.Issue[] = [];
        const todos: WorkspaceTodoInput[] = [];

        raw.forEach((item: unknown, index: number) => {
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            issues.push({ message: `todos[${index}] must be an object`, path: ["todos", index] });

            return;
          }

          const candidate = item as Record<string, unknown>;

          if (typeof candidate.content !== "string") {
            issues.push({
              message: `todos[${index}].content must be a string`,
              path: ["todos", index, "content"],
            });
          }

          if (!isTodoStatus(candidate.status)) {
            issues.push({
              message: `todos[${index}].status must be one of ${TODO_STATUSES.join(", ")}`,
              path: ["todos", index, "status"],
            });
          }

          if (candidate.id !== undefined && typeof candidate.id !== "string") {
            issues.push({
              message: `todos[${index}].id must be a string when provided`,
              path: ["todos", index, "id"],
            });
          }

          if (typeof candidate.content === "string" && isTodoStatus(candidate.status)) {
            todos.push({
              content: candidate.content,
              status: candidate.status,
              ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
            });
          }
        });

        if (issues.length === 0) {
          for (const problem of todoListProblems(todos)) {
            issues.push({ message: problem, path: ["todos"] });
          }
        }

        return issues.length > 0 ? { issues } : { value: { todos } };
      },
    },
  },
  TODO_WRITE_JSON_SCHEMA,
);

/** Input schema for the `todo_read` tool (no arguments). */
const todoReadSchema = withJsonSchema<Record<string, never>>(
  {
    "~standard": {
      version: 1,
      vendor: "ai-workspace",
      validate: () => ({ value: {} }),
    },
  },
  TODO_READ_JSON_SCHEMA,
);

/**
 * Build the agent-facing `todo_write` tool over a workspace's todo list:
 * the model sends the **complete** updated list (each item `content` +
 * `status` of `pending` / `in_progress` / `completed`, optional `id`) and it
 * replaces the old one. The list lives in memory, per workspace (shared by
 * its `readonly()` / `scope()` projections), for the length of the run.
 *
 * @param store - The workspace's todo list.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * await makeTodoWriteTool(store).invoke({
 *   todos: [
 *     { content: "Reproduce the failing test", status: "completed" },
 *     { content: "Fix the rounding bug", status: "in_progress" },
 *   ],
 * });
 */
export function makeTodoWriteTool(
  store: TodoStore,
  options?: { name?: string },
): ToolContract<TodoWriteInput, TodoListResult> {
  return tool<TodoWriteInput, TodoListResult>({
    name: options?.name ?? "todo_write",
    description:
      "Replace your todo list for this task with the complete updated list " +
      "(each item: content and status pending | in_progress | completed). " +
      "Use it to plan multi-step work and to mark progress.",
    action: "Updating the todo list",
    input: todoWriteSchema,
    execute: async (input) => store.write(input.todos),
  });
}

/**
 * Build the agent-facing `todo_read` tool: the workspace's current todo
 * list and a count per status.
 *
 * @param store - The workspace's todo list.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const { data } = await makeTodoReadTool(store).invoke({});
 * console.log(data?.counts.pending);
 */
export function makeTodoReadTool(
  store: TodoStore,
  options?: { name?: string },
): ToolContract<Record<string, never>, TodoListResult> {
  return tool<Record<string, never>, TodoListResult>({
    name: options?.name ?? "todo_read",
    description: "Read your current todo list for this task.",
    action: "Reading the todo list",
    input: todoReadSchema,
    execute: async () => store.read(),
  });
}
