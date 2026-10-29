import { Select } from "@mantine/core";
import { useSelectControl } from "../hooks/use-select-control";
import type { SelectProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function SelectInput(props: SelectProps) {
  const field = useSelectControl(props, false);
  return (
    <Select
      {...frameProps(props, field)}
      ref={field.binding.ref}
      className={props.className}
      data={props.options.map((option) => ({ ...option }))}
      value={field.selected[0] ?? null}
      onChange={(value) => (value === null ? field.clear() : field.select(value))}
      placeholder={props.placeholder}
      searchable
      clearable
      nothingFoundMessage={props.emptyLabel ?? "No options found"}
      clearButtonProps={{ "aria-label": props.clearLabel ?? "Clear" }}
    />
  );
}
