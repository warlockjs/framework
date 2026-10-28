import type { ApprovalMemory, ApprovalMemoryEntry } from "./contracts";

function entryKey(entry: ApprovalMemoryEntry): string {
  return entry.type === "tool"
    ? `tool:${entry.toolName}`
    : `args:${entry.toolName}:${entry.argsKey ?? ""}`;
}

/**
 * In-process {@link ApprovalMemory}: approvals live as long as the process.
 * Keep a reference to call `clear(sessionId)` when a session ends; it
 * holds at most `maxSessions` sessions (default 1000), dropping the
 * oldest first.
 *
 * @example
 * const memory = ai.human.approvalMemory();
 * humanApproval({ tools: { run_shell: "ask" }, handler, remember: { memory } });
 * memory.clear(sessionId);
 */
export function approvalMemory(options: { maxSessions?: number } = {}): ApprovalMemory {
  const maxSessions = options.maxSessions ?? 1000;
  const sessions = new Map<string, Set<string>>();

  return {
    has: (sessionId, entry) => sessions.get(sessionId)?.has(entryKey(entry)) ?? false,
    add(sessionId, entry) {
      let entries = sessions.get(sessionId);

      if (!entries) {
        entries = new Set();
        sessions.set(sessionId, entries);

        if (sessions.size > maxSessions) {
          sessions.delete(sessions.keys().next().value as string);
        }
      }

      entries.add(entryKey(entry));
    },
    clear(sessionId) {
      sessions.delete(sessionId);
    },
  };
}
