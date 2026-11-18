import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/common/EmptyState";
import { useSession } from "@/app/session";
import type { AdminPage as AdminPageId } from "@/lib/route";
import { AuditPage } from "./AuditPage";
import { SettingsPage } from "./SettingsPage";
import { SharesPage } from "./SharesPage";
import { UsersPage } from "./UsersPage";

const PAGES: { id: AdminPageId; label: string }[] = [
  { id: "users", label: "Users and invites" },
  { id: "audit", label: "Audit log" },
  { id: "settings", label: "Settings" },
  { id: "shares", label: "Share links" },
];

/** The admin area: users and invites, the audit log, and settings. Viewers see why it is closed to them. */
export function AdminPage({ page }: { page: AdminPageId }) {
  const { session } = useSession();

  if (session.role !== "admin" || session.mode !== "production") {
    return (
      <EmptyState
        title="This page is for admins."
        hint="Ask an admin of this dashboard to change your role, or sign in with an admin account."
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <nav
        aria-label="Admin pages"
        className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 text-sm"
      >
        {PAGES.filter((item) => item.id !== "shares" || session.share?.enabled).map((item) => (
          <a
            key={item.id}
            href={`#/admin/${item.id}`}
            aria-current={item.id === page ? "page" : undefined}
            className={cn(
              "flex min-h-8 items-center rounded-md px-3 whitespace-nowrap transition-colors max-md:min-h-10",
              item.id === page
                ? "bg-brand/10 font-semibold text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {page === "users" ? (
        <UsersPage />
      ) : page === "audit" ? (
        <AuditPage />
      ) : page === "shares" && session.share?.enabled ? (
        <SharesPage />
      ) : (
        <SettingsPage />
      )}
    </div>
  );
}
