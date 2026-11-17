import { createContext, useContext } from "react";
import type { DevtoolsAuthStepResult, DevtoolsSessionView } from "@contracts";

export type SessionContextValue = {
  session: DevtoolsSessionView;
  /** Reads `api/auth/session` again and shows the screen for the new stage. */
  refresh: () => Promise<void>;
  /** Takes a sign-in step's answer (new CSRF token) and moves to the next stage. */
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
  /** Signs out and returns to the sign-in screen. */
  signOut: () => Promise<void>;
  /** Shows the "dashboard turned off" screen (after an admin disabled it). */
  markDisabled: () => void;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

/** The signed-in session and the actions that change it. Only valid under `App`. */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);

  if (!value) throw new Error("useSession was called outside the dashboard shell.");

  return value;
}
