import { cn } from "@/lib/utils";

/** The product mark: a rounded tile with a stylised flame-W, drawn inline so it works offline. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-brand-foreground shadow-sm",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[60%]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 5l4 14 5-10 5 10 4-14" />
      </svg>
    </span>
  );
}
