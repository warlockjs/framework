import type { WorkspaceAfterEditEvent, WorkspacePolicy } from "../contracts";

/** How long a hook may take when the policy sets no `afterEditTimeoutMs`. */
const DEFAULT_HOOK_TIMEOUT_MS = 10_000;
/** Longest diagnostics text kept when the policy sets no `afterEditMaxChars`. */
const DEFAULT_MAX_CHARS = 4_000;

function wrap(text: string): string {
  return `[diagnostics]\n${text}\n[/diagnostics]`;
}

/**
 * Run the policy's `afterEdit` hook for one call and return the text to put
 * on the result's `diagnostics`, or `undefined` when there is none. A throw
 * or a timeout yields "diagnostics unavailable"; it never rejects.
 */
export async function runAfterEdit(
  policy: WorkspacePolicy,
  event: WorkspaceAfterEditEvent,
): Promise<string | undefined> {
  const hook = policy.hooks?.afterEdit;

  if (hook === undefined || event.paths.length === 0) {
    return undefined;
  }

  const timeoutMs = policy.hooks?.afterEditTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const maxChars = policy.hooks?.afterEditMaxChars ?? DEFAULT_MAX_CHARS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => hook(event)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("afterEdit hook timed out")), timeoutMs);
      }),
    ]);

    if (typeof answer !== "string" || answer.trim() === "") {
      return undefined;
    }

    const text = answer.trim();

    return wrap(
      text.length > maxChars
        ? `${text.slice(0, maxChars)}\n[diagnostics truncated: showing ${maxChars} of ${text.length} characters]`
        : text,
    );
  } catch {
    return wrap("diagnostics unavailable");
  } finally {
    clearTimeout(timer);
  }
}
