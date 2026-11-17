import type { DevtoolsPanelInfo } from "@contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InstancePicker } from "./InstancePicker";
import { Menu, MenuButton, MenuLink } from "./Menu";
import { useSession } from "./session";

export type HeaderProps = {
  panels: readonly DevtoolsPanelInfo[];
  /** The open tab id, or `null` on an account or admin page. */
  activeTab: string | null;
  instance: string;
  onInstanceChange: (instance: string) => void;
};

/** Product name, mode badge, instance picker, user and admin menus, and the tab strip. */
export function Header({ panels, activeTab, instance, onInstanceChange }: HeaderProps) {
  const { session, signOut } = useSession();
  const production = session.mode === "production";
  const label = production
    ? `Production${session.instance ? ` — ${session.instance.label}` : ""}`
    : "Development";

  return (
    <header className="border-b bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <h1 className="text-base font-semibold">Warlock Devtools</h1>
        <Badge variant={production ? "default" : "secondary"}>{label}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {production ? <InstancePicker value={instance} onChange={onInstanceChange} /> : null}
          {production && session.role === "admin" ? (
            <Menu label="Admin">
              {(close) => (
                <>
                  <MenuLink href="#/admin/users" onSelect={close}>
                    Users and invites
                  </MenuLink>
                  <MenuLink href="#/admin/audit" onSelect={close}>
                    Audit log
                  </MenuLink>
                  <MenuLink href="#/admin/settings" onSelect={close}>
                    Settings
                  </MenuLink>
                </>
              )}
            </Menu>
          ) : null}
          {production ? (
            <Menu label={session.account?.email ?? "Account"}>
              {(close) => (
                <>
                  <MenuLink href="#/account" onSelect={close}>
                    Account
                  </MenuLink>
                  <MenuButton
                    onClick={() => {
                      close();
                      void signOut();
                    }}
                  >
                    Sign out
                  </MenuButton>
                </>
              )}
            </Menu>
          ) : null}
        </div>
      </div>
      <nav aria-label="Dashboard tabs" className="flex gap-1 overflow-x-auto px-3">
        {panels.map((panel) => (
          <a
            key={panel.id}
            href={`#${panel.id}`}
            aria-current={panel.id === activeTab ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              panel.id === activeTab
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {panel.title}
          </a>
        ))}
      </nav>
    </header>
  );
}
