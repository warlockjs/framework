import { Radio } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { RadioProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function RadioInput(props: RadioProps) {
  // One scalar for the whole group; the first enabled radio receives the focus ref.
  const field = useControl(props);
  const { ref: bindRef } = field.binding;
  const firstEnabled = props.options.find((item) => !item.disabled);
  return (
    <Radio.Group
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      className={props.className}
      value={typeof field.value === "string" ? field.value : ""}
      onChange={field.changeValue}
      readOnly={props.readOnly}
    >
      <div>
        {props.options.map((option) => (
          <Radio
            key={option.value}
            ref={option === firstEnabled ? bindRef : undefined}
            id={`${props.id}-option-${encodeURIComponent(option.value)}`}
            value={option.value}
            label={option.label}
            disabled={field.disabled || option.disabled}
            mt="xs"
          />
        ))}
      </div>
    </Radio.Group>
  );
}
