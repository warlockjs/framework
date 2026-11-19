import { BrandMark } from "@/components/common/BrandMark";
import { useCallback, useEffect, useState } from "react";
import type { DevtoolsShareOpenAnswer } from "@contracts";
import { ApiError, apiFetch } from "@/api/client";
import { AuthLayout } from "@/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { useColorScheme } from "@/app/useColorScheme";
import { PanelHost } from "@/panel-host/PanelHost";
import { parseHash, shareRouteOf } from "@/lib/route";

type State =
  | { type: "loading" }
  | { type: "ready"; info: DevtoolsShareOpenAnswer }
  | { type: "closed" }
  | { type: "failed"; error: unknown };

const CLOSED_TEXT =
  "This link has expired or was revoked. Ask the person who shared it for a new one.";

/**
 * A read-only share link. `#/share/<token>` is exchanged once for a scoped
 * cookie (`POST api/share/open`), then the address becomes `#/share` so the
 * token is gone from the address bar and the history. The page shows only the
 * shared view of the one panel the link names; every refusal reads as an
 * expired link, the same page for a wrong, expired or revoked token.
 */
export function ShareScreen() {
  useColorScheme();

  const [initial] = useState(() => parseHash(location.hash));
  const [state, setState] = useState<State>({ type: "loading" });
  const [route, setRoute] = useState(() => shareRouteOf(location.hash));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const token = initial.type === "share" ? initial.token : null;
    // A reload after the exchange has no token left: the cookie carries the grant.
    const request =
      token !== null && attempt === 0
        ? apiFetch<DevtoolsShareOpenAnswer>("api/share/open", { method: "POST", body: { token } })
        : apiFetch<DevtoolsShareOpenAnswer>("api/share/info");

    request.then(
      (info) => {
        if (!current) return;

        if (token !== null && /^#\/share\/./.test(location.hash)) {
          history.replaceState(null, "", `${location.pathname}${location.search}#/share`);
        }

        setState({ type: "ready", info });
      },
      (error: unknown) => {
        if (!current) return;

        setState(
          error instanceof ApiError && error.status === 404
            ? { type: "closed" }
            : { type: "failed", error },
        );
      },
    );

    return () => {
      current = false;
    };
  }, [initial, attempt]);

  // The shared view moves between pages with `navigate()`, which changes the hash.
  useEffect(() => {
    const onChange = () => setRoute(shareRouteOf(location.hash));

    window.addEventListener("hashchange", onChange);

    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const retry = useCallback(() => {
    setState({ type: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  if (state.type === "loading") {
    return (
      <main className="mx-auto max-w-sm p-8">
        <LoadingRows rows={3} />
      </main>
    );
  }

  if (state.type === "closed") {
    return (
      <AuthLayout title="This link is not available">
        <p className="text-sm">{CLOSED_TEXT}</p>
      </AuthLayout>
    );
  }

  if (state.type === "failed") {
    return (
      <AuthLayout title="The page could not be opened">
        <ErrorMessage error={state.error} />
        <Button onClick={retry}>Try again</Button>
      </AuthLayout>
    );
  }

  const { info } = state;

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-card px-4 py-3.5 sm:px-6">
        <BrandMark />
        <h1 className="text-base font-semibold">{info.title}</h1>
        <span className="text-sm text-muted-foreground">{info.label}</span>
        <span className="ml-auto text-xs text-muted-foreground" data-testid="share-expiry">
          Read-only link · expires {new Date(info.expiresAt).toLocaleDateString()}
        </span>
      </header>
      <main className="mx-auto w-full max-w-[110rem] px-4 py-6 sm:px-8">
        <PanelHost id={info.panel} title={info.title} route={route} shared />
      </main>
    </div>
  );
}
