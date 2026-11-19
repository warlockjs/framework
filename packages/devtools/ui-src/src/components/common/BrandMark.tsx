import { cn } from "@/lib/utils";
import { WARLOCK_LOGO_DATA_URI } from "./warlock-logo";

/** The Warlock logo (an inlined PNG, so it works offline). Decorative: the name sits next to it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={WARLOCK_LOGO_DATA_URI}
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-lg bg-black", className)}
    />
  );
}
