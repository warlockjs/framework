import { RadioGroup, RadioGroupItem } from "web/components/ui/radio-group";
import { Label } from "web/components/ui/label";
import { useControl } from "../hooks/use-control";
import type { RadioProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function RadioInput(props: RadioProps) {
  // Register the group once as a scalar; individual Radix items own keyboard focus.
  const field = useControl(props);
  return (
    <FieldFrame {...props} error={field.error}>
      <RadioGroup
        {...field.binding}
        ref={(element) => {
          field.visibleElementRef.current = element;
        }}
        dir={props.dir}
        disabled={field.disabled || props.readOnly}
        value={typeof field.value === "string" ? field.value : ""}
        onValueChange={field.changeValue}
        aria-labelledby={`${props.id}-label`}
      >
        {props.options.map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem
              ref={
                option === props.options.find((item) => !item.disabled) ? field.inputRef : undefined
              }
              id={`${props.id}-option-${encodeURIComponent(option.value)}`}
              value={option.value}
              disabled={option.disabled}
            />
            <Label htmlFor={`${props.id}-option-${encodeURIComponent(option.value)}`}>
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </FieldFrame>
  );
}
