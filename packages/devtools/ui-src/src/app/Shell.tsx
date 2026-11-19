import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DevtoolsPanelInfo } from "@contracts";
import { useApi } from "@/api/hooks";
import { useConnection } from "@/api/connection";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { ViewBoundary } from "@/components/common/ViewBoundary";
import { AccountPage } from "@/account/AccountPage";
import { AdminPage } from "@/admin/AdminPage";
import { CircleUserIcon, ShieldCheckIcon, SunMoonIcon } from "lucide-react";
import { PanelHost } from "@/panel-host/PanelHost";
import { BUILT_IN_PANELS, isBuiltInPanel } from "@/panels/registry";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { Header } from "./Header";
import { groupPanels, iconFor, isAiTab } from "./nav";
import { Sidebar } from "./Sidebar";
import { useColorScheme } from "./useColorScheme";
import { useSession } from "./session";
import { useHashRoute } from "./useHashRoute";

/** The signed-in dashboard: sidebar with the tabs from `api/panels`, top bar, command palette and the open tab or page. */
export function Shell() {
  const { session } = useSession();
  const route = useHashRoute();
  const { setChoice } = useColorScheme();
  const [instance, setInstance] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuButton = useRef<HTMLElement | null>(null);
  const { generation } = useConnection();
  const panels = useApi<DevtoolsPanelInfo[]>("api/panels");
  const list = useMemo(() => panels.data ?? [], [panels.data]);
  const tabId =
    route.type === "tab"
      ? list.some((panel) => panel.id === route.id)
        ? route.id
        : (list[0]?.id ?? "")
      : null;

  const navigateTab = (id: string) => (next: string) => {
    location.hash = `#${id}${next ? `/${next}` : ""}`;
  };

  let content;
  const viewKey = `${generation}:${
    route.type === "admin"
      ? `admin:${route.page}`
      : route.type === "tab"
        ? `tab:${tabId ?? ""}`
        : route.type
  }`;
  const viewName =
    route.type === "account"
      ? "Account"
      : route.type === "admin"
        ? "Admin"
        : (list.find((panel) => panel.id === tabId)?.title ?? "tab");

  const title =
    route.type === "account"
      ? "Account"
      : route.type === "admin"
        ? `Admin: ${{ users: "Users and invites", audit: "Audit log", settings: "Settings", shares: "Share links" }[route.page]}`
        : viewName === "tab"
          ? "Dashboard"
          : isAiTab(tabId)
            ? `AI · ${viewName}`
            : viewName;

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  }, []);

  // Ctrl/Cmd+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const production = session.mode === "production";
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const go = (hash: string) => () => {
      location.hash = hash;
    };
    const items: PaletteItem[] = groupPanels(list).flatMap(({ group, items: tabs }) =>
      tabs.map((panel) => ({
        id: `tab:${panel.id}`,
        label: panel.title,
        group,
        icon: iconFor(panel.id),
        run: go(`#${panel.id}`),
      })),
    );

    if (production) {
      items.push({
        id: "account",
        label: "Account",
        group: "Account",
        icon: CircleUserIcon,
        run: go("#/account"),
      });
    }

    if (production && session.role === "admin") {
      for (const [page, label] of [
        ["users", "Admin: Users and invites"],
        ["audit", "Admin: Audit log"],
        ["settings", "Admin: Settings"],
        ...(session.share?.enabled ? ([["shares", "Admin: Share links"]] as const) : []),
      ] as const) {
        items.push({
          id: `admin:${page}`,
          label,
          group: "Admin",
          icon: ShieldCheckIcon,
          run: go(`#/admin/${page}`),
        });
      }
    }

    for (const choice of ["system", "light", "dark"] as const) {
      items.push({
        id: `theme:${choice}`,
        label: `Theme: ${choice}`,
        group: "Appearance",
        icon: SunMoonIcon,
        run: () => setChoice(choice),
      });
    }

    return items;
  }, [list, production, session.role, session.share?.enabled, setChoice]);

  if (route.type === "account") {
    content = <AccountPage />;
  } else if (route.type === "admin") {
    content = <AdminPage page={route.page} />;
  } else if (panels.error && !panels.data) {
    content = <ErrorMessage error={panels.error} />;
  } else if (!panels.data) {
    content = <LoadingRows />;
  } else if (!tabId) {
    content = (
      <EmptyState
        title="No tabs are enabled."
        hint="Turn tabs on in the devtools config (production.panels) and restart the app."
      />
    );
  } else {
    const info = list.find((panel) => panel.id === tabId);
    const tabRoute = route.type === "tab" && route.id === tabId ? route.route : "";

    if (info && isBuiltInPanel(info.id)) {
      const Panel = BUILT_IN_PANELS[info.id];

      content = (
        <Panel
          key={info.id}
          route={tabRoute}
          navigate={navigateTab(info.id)}
          instance={instance}
          session={session}
        />
      );
    } else if (info) {
      const canShare =
        info.shareable &&
        session.mode === "production" &&
        session.role === "admin" &&
        session.share?.enabled === true;

      content = (
        <PanelHost
          key={info.id}
          id={info.id}
          title={info.title}
          route={tabRoute}
          share={canShare ? { enabled: true, manageHref: `#/admin/shares?panel=${info.id}` } : null}
        />
      );
    }
  }

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar panels={list} activeTab={tabId} open={drawerOpen} onClose={closeDrawer} />
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation backdrop"
          tabIndex={-1}
          className="fixed inset-0 z-30 animate-dt-fade bg-black/50 lg:hidden"
          onClick={closeDrawer}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={title}
          instance={instance}
          onInstanceChange={setInstance}
          navigationOpen={drawerOpen}
          onOpenNavigation={() => {
            menuButton.current = document.activeElement as HTMLElement | null;
            setDrawerOpen(true);
          }}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="mx-auto w-full max-w-[110rem] flex-1 px-4 py-6 sm:px-8">
          <ViewBoundary key={viewKey} name={viewName}>
            {content}
          </ViewBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
    </div>
  );
}
