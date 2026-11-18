import { MenuIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstancePicker } from "./InstancePicker";
import { Menu, MenuButton, MenuLink } from "./Menu";
import { useSession } from "./session";
import { ThemeToggle } from "./ThemeToggle";

export type HeaderProps = {
  /** The open tab or page title. */
  title: string;
  instance: string;
  onInstanceChange: (instance: string) => void;
  onOpenNavigation: () => void;
  onOpenPalette: () => void;
  navigationOpen: boolean;
};

/** The slim top bar: menu button (narrow screens), page title, search, instance picker, theme and the user menus. */
export function Header({
  title,
  instance,
  onInstanceChange,
  onOpenNavigation,
  onOpenPalette,
  navigationOpen,
}: HeaderProps) {
  const { session, signOut } = useSession();
  const production = session.mode === "production";
  const email = session.account?.email ?? "Account";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        aria-controls="dashboard-sidebar"
        aria-expanded={navigationOpen}
        onClick={onOpenNavigation}
      >
        <MenuIcon />
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</h1>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground max-sm:w-10 max-sm:px-0"
        aria-label="Search tabs and pages"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={onOpenPalette}
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground sm:inline">
          Ctrl K
        </kbd>
      </Button>
      {production ? <InstancePicker value={instance} onChange={onInstanceChange} /> : null}
      <ThemeToggle />
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
              {session.share?.enabled ? (
                <MenuLink href="#/admin/shares" onSelect={close}>
                  Share links
                </MenuLink>
              ) : null}
            </>
          )}
        </Menu>
      ) : null}
      {production ? (
        <Menu label={email} avatar={email}>
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
    </header>
  );
}
