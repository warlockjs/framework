import { Button } from "web/components/ui/button";
import { Input } from "web/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "web/components/ui/popover";
import { useSelectControl } from "../hooks/use-select-control";
import type { SelectProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function SelectInput(props: SelectProps) {
  const field = useSelectControl(props, false);
  return (
    <FieldFrame {...props} error={field.error}>
      <Popover open={field.open} onOpenChange={field.setOpen}>
        <PopoverTrigger asChild>
          <Button
            {...field.binding}
            type="button"
            variant="outline"
            disabled={field.disabled || props.readOnly}
            aria-labelledby={`${props.id}-label ${props.id}-value`}
            aria-haspopup="dialog"
            aria-controls={`${props.id}-dialog`}
          >
            <span id={`${props.id}-value`}>
              {props.options
                .filter((option) => field.selected.includes(option.value))
                .map((option) => option.label)
                .join(", ") ||
                props.placeholder ||
                "Choose"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          id={`${props.id}-dialog`}
          dir={props.dir}
          align="start"
          aria-labelledby={`${props.id}-label`}
          onCloseAutoFocus={field.onBlur}
        >
          <Input
            id={`${props.id}-search`}
            role="combobox"
            aria-label={props.searchLabel ?? "Search options"}
            aria-expanded={field.open}
            aria-controls={`${props.id}-listbox`}
            aria-autocomplete="list"
            aria-activedescendant={
              field.activeOption
                ? `${props.id}-option-${encodeURIComponent(field.activeOption.value)}`
                : undefined
            }
            value={field.search}
            onChange={(event) => field.setSearch(event.target.value)}
            onKeyDown={field.onKeyDown}
          />
          <div
            id={`${props.id}-listbox`}
            role="listbox"
            aria-labelledby={`${props.id}-label`}
            aria-multiselectable={false}
            className="max-h-60 overflow-auto py-2"
          >
            {field.filtered.map((option) => (
              <Button
                key={option.value}
                id={`${props.id}-option-${encodeURIComponent(option.value)}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={field.selected.includes(option.value)}
                aria-disabled={option.disabled}
                disabled={option.disabled}
                variant="ghost"
                className="w-full justify-start aria-selected:bg-accent data-[active=true]:ring-2 data-[active=true]:ring-ring"
                data-active={field.activeOption === option}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => field.select(option.value)}
              >
                {field.selected.includes(option.value) ? "✓ " : ""}
                {option.label}
              </Button>
            ))}
          </div>
          {field.filtered.length === 0 ? (
            <p role="status">{props.emptyLabel ?? "No options found"}</p>
          ) : null}
          <Button type="button" variant="ghost" onClick={field.clear}>
            {props.clearLabel ?? "Clear"}
          </Button>
        </PopoverContent>
      </Popover>
    </FieldFrame>
  );
}
