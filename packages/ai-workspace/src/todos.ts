import type {
  TodoListResult,
  WorkspaceTodo,
  WorkspaceTodoInput,
  WorkspaceTodoStatus,
} from "./contracts";

/** Most items a todo list may hold. */
export const MAX_TODOS = 100;

/** Longest `content` one todo item may have. */
export const MAX_TODO_CONTENT_LENGTH = 1_000;

/** The statuses a todo item may have, in display order. */
export const TODO_STATUSES: readonly WorkspaceTodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
];

/**
 * Validate a whole replacement list. Returns the problems found (empty when
 * the list is valid) so the tool schema and the direct method share one
 * set of rules.
 */
export function todoListProblems(todos: readonly WorkspaceTodoInput[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  if (todos.length > MAX_TODOS) {
    problems.push(`a todo list holds at most ${MAX_TODOS} items (got ${todos.length})`);
  }

  todos.forEach((todo, index) => {
    if (todo.content.trim() === "") {
      problems.push(`todos[${index}].content must not be empty`);
    }

    if (todo.content.length > MAX_TODO_CONTENT_LENGTH) {
      problems.push(`todos[${index}].content is longer than ${MAX_TODO_CONTENT_LENGTH} characters`);
    }

    if (!TODO_STATUSES.includes(todo.status)) {
      problems.push(`todos[${index}].status must be one of ${TODO_STATUSES.join(", ")}`);
    }

    const id = todo.id ?? String(index + 1);

    if (ids.has(id)) {
      problems.push(`todos[${index}].id "${id}" is used more than once`);
    }

    ids.add(id);
  });

  return problems;
}

/**
 * The in-memory todo list of one workspace (shared by its projections).
 * `write` replaces the whole list, the way an agent's plan tool usually
 * works: the model sends the full updated list every time.
 */
export class TodoStore {
  private items: WorkspaceTodo[] = [];

  /** The current list and a count per status. */
  public read(): TodoListResult {
    const counts: Record<WorkspaceTodoStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
    };

    for (const item of this.items) {
      counts[item.status]++;
    }

    return { todos: this.items.map((item) => ({ ...item })), counts };
  }

  /**
   * Replace the list. Items without an `id` get their 1-based position as
   * one. Throws a `RangeError` naming every problem when the list is invalid
   * (too long, empty content, unknown status, duplicate id); the old list is
   * kept in that case.
   */
  public write(todos: readonly WorkspaceTodoInput[]): TodoListResult {
    const problems = todoListProblems(todos);

    if (problems.length > 0) {
      throw new RangeError(`Invalid todo list: ${problems.join("; ")}.`);
    }

    this.items = todos.map((todo, index) => ({
      id: todo.id ?? String(index + 1),
      content: todo.content.trim(),
      status: todo.status,
    }));

    return this.read();
  }
}
