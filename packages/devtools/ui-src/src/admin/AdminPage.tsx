import { EmptyState } from "@/components/common/EmptyState";
import { useSession } from "@/app/session";
import type { AdminPage as AdminPageId } from "@/lib/route";
import { AuditPage } from "./AuditPage";
import { SettingsPage } from "./SettingsPage";
import { UsersPage } from "./UsersPage";

const PAGES: { id: AdminPageId; label: string }[] = [
  { id: "users", label: "Users and invites" },
  { id: "audit", label: "Audit log" },
  { id: "settings", label: "Settings" },
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
    <div className="mx-auto grid max-w-5xl gap-4">
      <nav aria-label="Admin pages" className="flex gap-3 text-sm">
        {PAGES.map((item) => (
          <a
            key={item.id}
            href={`#/admin/${item.id}`}
            aria-current={item.id === page ? "page" : undefined}
            className={item.id === page ? "font-semibold underline" : "text-muted-foreground"}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {page === "users" ? <UsersPage /> : page === "audit" ? <AuditPage /> : <SettingsPage />}
    </div>
  );
}
