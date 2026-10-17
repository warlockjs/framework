/**
 * Thrown by a fake's `assert*` helper. The message says what was expected and
 * lists what the fake actually recorded, so a failing test explains itself.
 */
export class FakeAssertionError extends Error {
  public constructor(message: string) {
    super(message);

    this.name = "FakeAssertionError";
  }
}

/** Render recorded entries for an assertion message, one per line. */
export function describeRecorded<T>(
  entries: readonly T[],
  describe: (entry: T) => string,
  noun: string,
): string {
  if (entries.length === 0) return `Nothing was ${noun}.`;

  return `${entries.length} ${entries.length === 1 ? "entry was" : "entries were"} ${noun}:\n${entries
    .map((entry, index) => `  ${index + 1}. ${describe(entry)}`)
    .join("\n")}`;
}
