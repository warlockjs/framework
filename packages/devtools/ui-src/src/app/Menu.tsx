import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MenuProps = {
  label: string;
  /** When set, a round initial of this text is shown before the label (the account menu). */
  avatar?: string;
  children: (close: () => void) => ReactNode;
};

/** A small disclosure menu for the header; closes on outside click and on Escape, arrow keys move between items. */
export function Menu({ label, avatar, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const items = () =>
      Array.from(wrapper.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);

    items()[0]?.focus();

    const onPointer = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLElement);
        const step = event.key === "ArrowDown" ? 1 : -1;

        event.preventDefault();
        list[(index + step + list.length) % list.length]?.focus();
      }
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-48 max-md:px-2"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {avatar ? (
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand uppercase"
          >
            {avatar.trim().charAt(0) || "?"}
          </span>
        ) : null}
        <span className={avatar ? "hidden truncate md:inline" : "truncate"}>{label}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 grid min-w-48 animate-dt-pop gap-0.5 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {avatar ? (
            <p className="truncate px-2.5 py-1.5 text-xs text-muted-foreground">{avatar}</p>
          ) : null}
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

const itemClass =
  "flex min-h-9 w-full items-center rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none max-md:min-h-10";

/** A link row inside a `Menu`. */
export function MenuLink({
  href,
  onSelect,
  children,
}: {
  href: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <a role="menuitem" href={href} className={itemClass} onClick={onSelect}>
      {children}
    </a>
  );
}

/** A button row inside a `Menu`. */
export function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className={itemClass} onClick={onClick}>
      {children}
    </button>
  );
}
