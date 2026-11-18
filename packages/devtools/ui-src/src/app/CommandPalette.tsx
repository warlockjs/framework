import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { NavIcon } from "./nav";

export type PaletteItem = {
  id: string;
  label: string;
  /** The section shown beside the label ("Monitor", "Account"). */
  group: string;
  icon: NavIcon;
  run: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly PaletteItem[];
};

/**
 * Ctrl/Cmd+K: type to filter the tabs and pages, arrow keys move, Enter opens,
 * Escape closes. It is a dialog, so focus stays inside while it is open.
 */
export function CommandPalette({ open, onOpenChange, items }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return needle
      ? items.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(needle))
      : items;
  }, [items, query]);

  const current = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;

    onOpenChange(false);
    setQuery("");
    setActive(0);
    item.run();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(shown.length ? (current + 1) % shown.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(shown.length ? (current - 1 + shown.length) % shown.length : 0);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(shown.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(shown[current]);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search tabs and pages</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter, use the arrow keys to move and Enter to open.
        </DialogDescription>
        <div className="flex items-center gap-2.5 border-b px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown.length ? `${listId}-${current}` : undefined}
            aria-label="Search tabs and pages"
            placeholder="Jump to a tab or page"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing matches &ldquo;{query}&rdquo;. Try a tab name such as requests or logs.
            </li>
          ) : null}
          {shown.map((item, index) => {
            const Icon = item.icon;
            const selected = index === current;

            return (
              <li
                key={item.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected}
                data-index={index}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(item)}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm",
                  selected ? "bg-brand/10 text-brand" : "text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.group}</span>
                {selected ? (
                  <CornerDownLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
