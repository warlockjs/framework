import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MenuProps = {
  label: string;
  children: (close: () => void) => ReactNode;
};

/** A small disclosure menu for the header; closes on outside click and on Escape. */
export function Menu({ label, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDownIcon />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 grid min-w-44 gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

const itemClass =
  "block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground";

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
