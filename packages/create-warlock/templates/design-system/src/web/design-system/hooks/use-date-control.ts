import { useState } from "react";
import { useControl } from "./use-control";
import type { DateProps } from "../types/control-props";

export function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseCalendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return calendarDate(date) === value ? date : undefined;
}
export function useDateControl(props: DateProps, withTime = false) {
  const field = useControl(props);
  const [open, setOpen] = useState(false);
  const value = typeof field.value === "string" ? field.value : "";
  const [datePart = "", time = ""] = value.split("T");
  return {
    ...field,
    open,
    setOpen,
    value,
    time,
    selected: parseCalendarDate(datePart),
    select: (date: Date | undefined) => {
      if (field.disabled || props.readOnly) {
        return;
      }
      field.changeValue(date ? calendarDate(date) + (withTime ? `T${time || "00:00"}` : "") : "");
      if (!withTime) {
        setOpen(false);
      }
    },
    changeTime: (next: string) => {
      if (!field.disabled && !props.readOnly) {
        field.changeValue(next && parseCalendarDate(datePart) ? `${datePart}T${next}` : "");
      }
    },
    clear: () => {
      if (!field.disabled && !props.readOnly) {
        field.changeValue("");
      }
      setOpen(false);
    },
  };
}
