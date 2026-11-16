/**
 * Work started after a response is already on its way (token writes and
 * delivery for password-reset and OTP requests). Each job owns its errors; the
 * set only lets a spec wait for the jobs to finish.
 */
const pending = new Set<Promise<void>>();

/** Start `job` without awaiting it. `job` must handle its own failures. */
export function runInBackground(job: () => Promise<void>): void {
  const running = Promise.resolve()
    .then(job)
    .catch(() => {})
    .finally(() => pending.delete(running));

  pending.add(running);
}

/** Resolve when every background job started so far has finished. */
export async function settleBackgroundWork(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
