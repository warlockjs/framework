import { useState, type KeyboardEvent } from "react";
import { useControl } from "./use-control";
import type { SelectProps } from "../types/control-props";

export function selectedValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value !== ""
      ? [value]
      : [];
}
export function toggleSelection(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
export function useSelectControl(props: SelectProps, multiple = false) {
  const field = useControl(props, "text", multiple);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const selected = selectedValues(field.value);
  const filtered = props.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const enabled = filtered.filter((option) => !option.disabled);
  const activeOption = enabled[Math.min(active, Math.max(0, enabled.length - 1))];
  const select = (value: string) => {
    if (field.disabled || props.readOnly) return;
    field.changeValue(multiple ? toggleSelection(selected, value) : value);
    if (!multiple) setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const current = activeOption ? enabled.indexOf(activeOption) : 0;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabled.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) %
              Math.max(1, enabled.length);
      setActive(Math.max(0, next));
      const option = enabled[Math.max(0, next)];
      if (option)
        document
          .getElementById(`${props.id}-option-${encodeURIComponent(option.value)}`)
          ?.scrollIntoView({ block: "nearest" });
    } else if (
      (event.key === "Enter" || (multiple && event.key === " " && search === "")) &&
      activeOption
    ) {
      event.preventDefault();
      select(activeOption.value);
    }
  };
  return {
    ...field,
    open,
    setOpen: (next: boolean) => {
      setOpen(next && !field.disabled && !props.readOnly);
      setSearch("");
      setActive(0);
    },
    search,
    setSearch: (next: string) => {
      setSearch(next);
      setActive(0);
    },
    selected,
    filtered,
    activeOption,
    select,
    onKeyDown,
    clear: () => {
      if (!field.disabled && !props.readOnly) field.changeValue(multiple ? [] : "");
    },
  };
}
