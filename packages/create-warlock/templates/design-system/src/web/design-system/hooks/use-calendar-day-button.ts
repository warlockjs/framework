import { useEffect, useRef } from "react";

export function useCalendarDayButton(focused: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused]);
  return ref;
}
