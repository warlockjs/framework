import { MultiSelect } from "@mantine/core";
import { useSelectControl } from "../hooks/use-select-control";
import type { SelectProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function MultiSelectInput(props: SelectProps) {
  const field = useSelectControl(props, true);
  const { ref: bindRef } = field.binding;
  return (
    <MultiSelect
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      data={props.options.map((option) => ({ ...option }))}
      value={field.selected}
      onChange={(values) => {
        if (!field.disabled && !props.readOnly) {
          field.changeValue(values);
        }
      }}
      placeholder={props.placeholder}
      searchable
      clearable
      nothingFoundMessage={props.emptyLabel ?? "No options found"}
      clearButtonProps={{ "aria-label": props.clearLabel ?? "Clear" }}
    />
  );
}
