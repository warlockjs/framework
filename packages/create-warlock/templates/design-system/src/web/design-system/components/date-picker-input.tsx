import { Button } from "web/components/ui/button";
import { Calendar } from "web/components/ui/calendar";

import { Popover, PopoverContent, PopoverTrigger } from "web/components/ui/popover";
import { useDateControl } from "../hooks/use-date-control";
import type { DateProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function DatePickerInput(props: DateProps) {
  const field = useDateControl(props, false);
  return (
    <FieldFrame {...props} error={field.error}>
      <Popover modal open={field.open} onOpenChange={field.setOpen}>
        <PopoverTrigger asChild>
          <Button
            {...field.binding}
            type="button"
            variant="outline"
            disabled={field.disabled || props.readOnly}
            aria-haspopup="dialog"
            aria-controls={`${props.id}-dialog`}
            aria-labelledby={`${props.id}-label ${props.id}-value`}
          >
            <span id={`${props.id}-value`}>
              {field.value || props.placeholder || "Choose date"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          id={`${props.id}-dialog`}
          aria-modal="true"
          dir={props.dir}
          align="start"
          aria-labelledby={`${props.id}-label`}
          onCloseAutoFocus={field.onBlur}
        >
          <Calendar
            id={`${props.id}-calendar`}
            mode="single"
            autoFocus
            dir={props.dir}
            selected={field.selected}
            defaultMonth={field.selected}
            onSelect={field.select}
          />

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={field.clear}>
              {props.clearLabel ?? "Clear"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => field.setOpen(false)}>
              {props.closeLabel ?? "Close"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </FieldFrame>
  );
}
