import { useEffect, useRef } from "react";
import type { DevtoolsPanelInfo } from "@contracts";
import { XIcon } from "lucide-react";
import { BrandMark } from "@/components/common/BrandMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupPanels, iconFor } from "./nav";
import { useSession } from "./session";

export type SidebarProps = {
  panels: readonly DevtoolsPanelInfo[];
  /** The open tab id, or `null` on an account or admin page. */
  activeTab: string | null;
  /** On narrow screens the sidebar is a slide-over drawer; this says whether it is shown. */
  open: boolean;
  onClose: () => void;
};

/**
 * The left navigation: product mark, mode badge and the tabs in sections. On
 * wide screens it is a fixed column; on narrow screens it slides over the page
 * (Escape or the backdrop closes it, and Tab stays inside while it is open).
 */
export function Sidebar({ panels, activeTab, open, onClose }: SidebarProps) {
  const { session } = useSession();
  const aside = useRef<HTMLElement>(null);
  const production = session.mode === "production";
  const label = production
    ? `Production${session.instance ? ` — ${session.instance.label}` : ""}`
    : "Development";

  useEffect(() => {
    if (!open) return;

    const root = aside.current;
    const focusable = () =>
      Array.from(root?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);

    (root?.querySelector<HTMLElement>("[aria-current='page']") ?? focusable()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();

        return;
      }

      if (event.key !== "Tab") return;

      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      ref={aside}
      id="dashboard-sidebar"
      data-open={open}
      aria-label="Navigation"
      className={cn(
        "flex w-64 shrink-0 flex-col border-r bg-card",
        "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-72 max-lg:max-w-[85vw] max-lg:shadow-2xl",
        "max-lg:data-[open=false]:invisible lg:sticky lg:top-0 lg:h-screen",
        "max-lg:data-[open=true]:animate-dt-drawer",
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <BrandMark />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold tracking-tight">Warlock</p>
          <p className="text-xs text-muted-foreground">Devtools</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto lg:hidden"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="px-4 pb-3">
        <Badge variant={production ? "brand" : "neutral"} className="max-w-full">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              production ? "bg-brand" : "bg-muted-foreground",
            )}
          />
          <span className="truncate">{label}</span>
        </Badge>
      </div>
      <nav aria-label="Dashboard tabs" className="flex-1 overflow-y-auto px-2.5 pb-4">
        {groupPanels(panels).map(({ group, items }) => (
          <div key={group} className="mt-3 first:mt-0">
            <p className="px-2.5 pb-1 text-xs font-semibold text-muted-foreground">{group}</p>
            <ul className="grid gap-0.5">
              {items.map((panel) => {
                const Icon = iconFor(panel.id);
                const active = panel.id === activeTab;

                return (
                  <li key={panel.id}>
                    <a
                      href={`#${panel.id}`}
                      aria-current={active ? "page" : undefined}
                      onClick={open ? onClose : undefined}
                      className={cn(
                        "group relative flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors lg:min-h-9",
                        active
                          ? "bg-brand/10 font-semibold text-brand"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-brand"
                        />
                      ) : null}
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{panel.title}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
