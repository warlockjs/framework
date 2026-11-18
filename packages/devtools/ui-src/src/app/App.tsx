import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DevtoolsAuthStepResult, DevtoolsSessionView } from "@contracts";
import { NOT_FOUND_EVENT, apiFetch, setCsrfToken } from "@/api/client";
import { InviteScreen } from "@/auth/InviteScreen";
import { LoginScreen } from "@/auth/LoginScreen";
import { MfaEnrolScreen } from "@/auth/MfaEnrolScreen";
import { MfaVerifyScreen } from "@/auth/MfaVerifyScreen";
import { PasswordChangeScreen } from "@/auth/PasswordChangeScreen";
import { SetupScreen } from "@/auth/SetupScreen";
import { AuthLayout } from "@/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { clearHash, isShareHash, parseHash, type HashRoute } from "@/lib/route";
import { ShareScreen } from "@/share/ShareScreen";
import { Shell } from "./Shell";
import { SessionContext, type SessionContextValue } from "./session";
import { useColorScheme } from "./useColorScheme";

const SESSION_ENDED = "Your session ended. Sign in again.";

type SignInLink = Extract<HashRoute, { type: "setup" | "invite" }>;

function readLink(): SignInLink | null {
  const route = parseHash(location.hash);

  return route.type === "setup" || route.type === "invite" ? route : null;
}

/**
 * The dashboard root. Reads `api/auth/session`, shows the sign-in screen for
 * the session's stage (or the shell when it is active), reads setup and
 * invite tokens from the hash once and removes them from the address, and
 * returns to sign-in when the server stops answering the session.
 */
export function App() {
  // A read-only share link needs no sign-in: it never reads the session.
  const [sharing] = useState(() => isShareHash(location.hash));

  return sharing ? <ShareScreen /> : <Dashboard />;
}

function Dashboard() {
  useColorScheme();

  const [session, setSession] = useState<DevtoolsSessionView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [link, setLink] = useState<SignInLink | null>(readLink);
  const stageRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<DevtoolsSessionView | null> => {
    try {
      const view = await apiFetch<DevtoolsSessionView>("api/auth/session");

      setCsrfToken(view.csrf);
      setSession(view);
      setError(null);

      return view;
    } catch (reason) {
      setError(reason);

      return null;
    }
  }, []);

  // The shell's relative URLs need the trailing slash.
  useEffect(() => {
    if (!location.pathname.endsWith("/")) {
      location.replace(`${location.pathname}/${location.search}${location.hash}`);
    }
  }, []);

  useEffect(() => {
    stageRef.current = session?.stage ?? null;
  }, [session]);

  // The first read starts from a promise callback, so no state is set while the effect runs.
  useEffect(() => {
    let current = true;

    void apiFetch<DevtoolsSessionView>("api/auth/session").then(
      (view) => {
        if (!current) return;

        setCsrfToken(view.csrf);
        setSession(view);
        setError(null);
      },
      (reason: unknown) => {
        if (current) setError(reason);
      },
    );

    return () => {
      current = false;
    };
  }, []);

  // A setup or invite token is read once, then removed from the address and history.
  useEffect(() => {
    const take = () => {
      const next = readLink();

      if (next) {
        setLink(next);
        clearHash();
      }
    };

    take();
    window.addEventListener("hashchange", take);

    return () => window.removeEventListener("hashchange", take);
  }, []);

  // A bare 404 on an API call means the session ended: read it again and go back to sign-in.
  useEffect(() => {
    const onNotFound = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;

      if (path === "api/auth/session") return;

      const wasSignedIn = stageRef.current !== null && stageRef.current !== "signed-out";

      void load().then((view) => {
        if (view?.stage === "signed-out" && wasSignedIn) setNotice(SESSION_ENDED);
      });
    };

    window.addEventListener(NOT_FOUND_EVENT, onNotFound);

    return () => window.removeEventListener(NOT_FOUND_EVENT, onNotFound);
  }, [load]);

  const onStep = useCallback(
    async (result: DevtoolsAuthStepResult) => {
      if (result.csrf) setCsrfToken(result.csrf);

      setNotice(null);
      setLink(null);
      await load();
    },
    [load],
  );

  const signOut = useCallback(async () => {
    try {
      await apiFetch("api/auth/logout", { method: "POST" });
    } catch {
      // The session may already be gone; reading it again shows the sign-in screen.
    }

    setCsrfToken(null);
    setNotice(null);
    await load();
  }, [load]);

  const value = useMemo<SessionContextValue | null>(
    () =>
      session
        ? {
            session,
            refresh: async () => {
              await load();
            },
            onStep,
            signOut,
            markDisabled: () => setDisabled(true),
          }
        : null,
    [session, load, onStep, signOut],
  );

  if (disabled) {
    return (
      <AuthLayout title="The dashboard is turned off">
        <p className="text-sm">
          It is closed on every instance. To open it again, run <code>warlock devtools:enable</code>{" "}
          on the server, or deploy with a new <code>DEVTOOLS_PATH</code>.
        </p>
      </AuthLayout>
    );
  }

  if (!session || !value) {
    return error ? (
      <AuthLayout title="The dashboard could not start">
        <ErrorMessage error={error} />
        <Button
          onClick={() => {
            setError(null);
            void load();
          }}
        >
          Try again
        </Button>
      </AuthLayout>
    ) : (
      <main className="mx-auto max-w-sm p-8">
        <LoadingRows rows={3} />
      </main>
    );
  }

  const signedOutLink = session.stage === "signed-out" ? link : null;
  const cancelLink = () => setLink(null);
  let screen;

  switch (session.stage) {
    case "signed-out":
      screen =
        signedOutLink?.type === "setup" ? (
          <SetupScreen token={signedOutLink.token} onStep={onStep} onCancel={cancelLink} />
        ) : signedOutLink?.type === "invite" ? (
          <InviteScreen token={signedOutLink.token} onStep={onStep} onCancel={cancelLink} />
        ) : (
          <LoginScreen notice={notice} onStep={onStep} />
        );
      break;
    case "password-change":
      screen = <PasswordChangeScreen onStep={onStep} onSignOut={signOut} />;
      break;
    case "mfa-enrol":
      screen = <MfaEnrolScreen session={session} onStep={onStep} onSignOut={signOut} />;
      break;
    case "mfa-verify":
      screen = <MfaVerifyScreen session={session} onStep={onStep} onSignOut={signOut} />;
      break;
    default:
      screen = <Shell />;
  }

  return <SessionContext.Provider value={value}>{screen}</SessionContext.Provider>;
}
