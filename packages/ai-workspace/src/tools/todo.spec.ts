import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "@warlock.js/ai";
import { TodoStore } from "../todos";
import { makeTodoReadTool, makeTodoWriteTool } from "./todo";

describe("todo tools", () => {
  it("replace the whole list, assign missing ids and count statuses", async () => {
    const store = new TodoStore();
    const write = makeTodoWriteTool(store);
    const read = makeTodoReadTool(store);

    const { data } = await write.invoke({
      todos: [
        { content: "Reproduce the bug", status: "completed" },
        { id: "fix", content: "  Fix it  ", status: "in_progress" },
        { content: "Add a test", status: "pending" },
      ],
    });

    expect(data).toEqual({
      todos: [
        { id: "1", content: "Reproduce the bug", status: "completed" },
        { id: "fix", content: "Fix it", status: "in_progress" },
        { id: "3", content: "Add a test", status: "pending" },
      ],
      counts: { pending: 1, in_progress: 1, completed: 1 },
    });
    expect((await read.invoke({})).data).toEqual(data);

    await write.invoke({ todos: [] });
    expect((await read.invoke({})).data?.todos).toEqual([]);
  });

  it("rejects an invalid list and keeps the old one", async () => {
    const store = new TodoStore();
    const write = makeTodoWriteTool(store);

    store.write([{ content: "keep me", status: "pending" }]);

    for (const todos of [
      [{ content: "x", status: "done" }],
      [{ content: "   ", status: "pending" }],
      [
        { id: "a", content: "x", status: "pending" },
        { id: "a", content: "y", status: "pending" },
      ],
      Array.from({ length: 101 }, () => ({ content: "x", status: "pending" })),
      "not a list",
    ]) {
      expect((await write.invoke({ todos })).error).toBeInstanceOf(SchemaValidationError);
    }

    expect(store.read().todos.map((todo) => todo.content)).toEqual(["keep me"]);
    expect(() => store.write([{ content: "", status: "pending" }])).toThrow(RangeError);
  });
});
