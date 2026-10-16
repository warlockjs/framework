import readline from "node:readline";
import { afterEach, expect, it, vi } from "vitest";
import { select } from "../../../src/cli/commands/generate/utils/prompt";

afterEach(() => vi.restoreAllMocks());
it("rejects empty choices before opening terminal input", async () => {
  const create = vi.spyOn(readline, "createInterface");
  await expect(select("Choose", [])).rejects.toThrow("at least one choice");
  expect(create).not.toHaveBeenCalled();
});
it.each([
  ["2", "second"],
  ["invalid", "first"],
])("returns a definite choice for %s", async (answer, expected) => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(readline, "createInterface").mockReturnValue({
    close: vi.fn(),
    question: (_prompt: string, reply: (answer: string) => void) => reply(answer),
  } as unknown as ReturnType<typeof readline.createInterface>);
  await expect(select("Choose", ["first", "second"])).resolves.toBe(expected);
});
