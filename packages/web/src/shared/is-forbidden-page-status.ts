/**
 * True for the statuses the forbidden page answers: 401 (no sign-in redirect
 * configured) and 403. Shared by the server render and client hydration so both
 * pick the same special page for the same failure; it imports nothing, so it is
 * safe in the browser bundle.
 */
export function isForbiddenPageStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}
