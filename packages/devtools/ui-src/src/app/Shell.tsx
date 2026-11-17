import { useState } from "react";
import type { DevtoolsPanelInfo } from "@contracts";
import { useApi } from "@/api/hooks";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { ViewBoundary } from "@/components/common/ViewBoundary";
import { AccountPage } from "@/account/AccountPage";
import { AdminPage } from "@/admin/AdminPage";
import { PanelHost } from "@/panel-host/PanelHost";
import { BUILT_IN_PANELS, isBuiltInPanel } from "@/panels/registry";
import { Header } from "./Header";
import { useSession } from "./session";
import { useHashRoute } from "./useHashRoute";

/** The signed-in dashboard: header, tabs from `api/panels`, and the open tab or page. */
export function Shell() {
  const { session } = useSession();
  const route = useHashRoute();
  const [instance, setInstance] = useState("all");
  const panels = useApi<DevtoolsPanelInfo[]>("api/panels");
  const list = panels.data ?? [];
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
  const viewKey =
    route.type === "admin"
      ? `admin:${route.page}`
      : route.type === "tab"
        ? `tab:${tabId ?? ""}`
        : route.type;
  const viewName =
    route.type === "account"
      ? "Account"
      : route.type === "admin"
        ? "Admin"
        : (list.find((panel) => panel.id === tabId)?.title ?? "tab");

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
      content = <PanelHost key={info.id} id={info.id} title={info.title} route={tabRoute} />;
    }
  }

  return (
    <div className="min-h-screen">
      <Header panels={list} activeTab={tabId} instance={instance} onInstanceChange={setInstance} />
      <main className="p-4">
        <ViewBoundary key={viewKey} name={viewName}>
          {content}
        </ViewBoundary>
      </main>
    </div>
  );
}
