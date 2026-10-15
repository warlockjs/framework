import { useSyncExternalStore } from "react";

type Listener = () => void;

/** Every submission still in flight. More than one only for `independent` forms. */
const activeTickets = new Set<symbol>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeSubmitting(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readSubmitting(): boolean {
  return activeTickets.size > 0;
}

/** The server never has a client action in flight. */
export function readSubmittingOnServer(): false {
  return false;
}

/**
 * Marks one submit as in flight and returns its completion. The snapshot is
 * true while ANY submit is in flight, so a newer submit cannot pulse `false`
 * while it takes over, and an `independent` form finishing first does not
 * clear a submission that is still running.
 */
export function beginSubmitting(): () => void {
  const ticket = Symbol("warlock.action.submitting");
  const wasSubmitting = activeTickets.size > 0;

  activeTickets.add(ticket);
  if (!wasSubmitting) notify();

  return () => {
    if (!activeTickets.delete(ticket)) return;
    if (activeTickets.size === 0) notify();
  };
}

/**
 * Whether a page action submitted from this document is still in flight.
 *
 * A submission whose action answers with a redirect stays in flight until the
 * redirected page is on screen (its loaders ran and the tree committed), so a
 * form guarded by this hook cannot submit again against the previous page's
 * data.
 */
export function useIsSubmitting(): boolean {
  return useSyncExternalStore(subscribeSubmitting, readSubmitting, readSubmittingOnServer);
}
