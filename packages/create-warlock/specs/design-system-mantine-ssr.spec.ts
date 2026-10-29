import { Form } from "@mongez/react-form";
import { MantineProvider } from "@mantine/core";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CheckboxInput from "../templates/design-system-mantine/src/web/design-system/components/checkbox-input";
import DatePickerInput from "../templates/design-system-mantine/src/web/design-system/components/date-picker-input";
import DateTimePickerInput from "../templates/design-system-mantine/src/web/design-system/components/date-time-picker-input";
import EmailInput from "../templates/design-system-mantine/src/web/design-system/components/email-input";
import FileInput from "../templates/design-system-mantine/src/web/design-system/components/file-input";
import MultiSelectInput from "../templates/design-system-mantine/src/web/design-system/components/multi-select-input";
import PaginatedTable from "../templates/design-system-mantine/src/web/design-system/components/paginated-table";
import PasswordInput from "../templates/design-system-mantine/src/web/design-system/components/password-input";
import RadioInput from "../templates/design-system-mantine/src/web/design-system/components/radio-input";
import SelectInput from "../templates/design-system-mantine/src/web/design-system/components/select-input";
import SubmitButton from "../templates/design-system-mantine/src/web/design-system/components/submit-button";
import SwitchInput from "../templates/design-system-mantine/src/web/design-system/components/switch-input";
import TextInput from "../templates/design-system-mantine/src/web/design-system/components/text-input";
import TextareaInput from "../templates/design-system-mantine/src/web/design-system/components/textarea-input";
import TimePickerInput from "../templates/design-system-mantine/src/web/design-system/components/time-picker-input";
import DesignSystemProvider from "../templates/design-system-mantine/src/web/design-system/provider";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", disabled: true },
];
const base = { id: "field", name: "field", label: "Field label" };
const html = (component: ComponentType<never>, props: Record<string, unknown>) =>
  renderToString(
    createElement(
      MantineProvider,
      null,
      createElement(Form, null, createElement(component as ComponentType<object>, props)),
    ),
  );

const controls: [string, ComponentType<never>, Record<string, unknown>][] = [
  ["TextInput", TextInput, {}],
  ["EmailInput", EmailInput, {}],
  ["PasswordInput", PasswordInput, {}],
  ["TextareaInput", TextareaInput, {}],
  ["SelectInput", SelectInput, { options }],
  ["MultiSelectInput", MultiSelectInput, { options }],
  ["CheckboxInput", CheckboxInput, {}],
  ["RadioInput", RadioInput, { options }],
  ["SwitchInput", SwitchInput, {}],
  ["DatePickerInput", DatePickerInput, {}],
  ["DateTimePickerInput", DateTimePickerInput, {}],
  ["TimePickerInput", TimePickerInput, {}],
  ["FileInput", FileInput, {}],
];

describe("Mantine contract components render on the server", () => {
  it.each(controls)(
    "%s renders label, hint and the error through Mantine",
    (_name, component, extra) => {
      const markup = html(component, {
        ...base,
        ...extra,
        hint: "Helpful hint",
        error: "Something is wrong",
        required: true,
      });
      expect(markup).toContain("Field label");
      expect(markup).toContain("Helpful hint");
      expect(markup).toContain("Something is wrong");
      expect(markup).toContain("field");
    },
  );

  it.each(controls)(
    "%s is stable between two renders (no hydration drift)",
    (_name, component, extra) => {
      expect(html(component, { ...base, ...extra })).toBe(html(component, { ...base, ...extra }));
    },
  );

  it("marks a text input invalid and links its error", () => {
    const markup = html(TextInput, { ...base, error: "Bad", hint: "Hint" });
    expect(markup).toMatch(/<input[^>]*id="field"/);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("field-error");
  });

  it("applies disabled and required the way the shadcn kit does", () => {
    const markup = html(TextInput, { ...base, disabled: true, required: true });
    expect(markup).toMatch(/<input[^>]*disabled/);
    // Required shows the asterisk but is not the native attribute: forms use noValidate.
    expect(markup).not.toMatch(/<input[^>]*\srequired(=|\s|>)/);
    expect(markup).toContain("*");
  });

  it("renders a submit button as a submit control", () => {
    const markup = html(SubmitButton, { id: "send", name: "send", label: "Send it" });
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("Send it");
  });

  it("renders the provider with the notifications host around the page", () => {
    const markup = renderToString(
      createElement(DesignSystemProvider, null, createElement("p", null, "page")),
    );
    expect(markup).toContain("page");
    expect(markup).toContain("data-mantine-styles");
  });

  it("renders a paginated table from the framework's pagination block", () => {
    const markup = renderToString(
      createElement(
        MantineProvider,
        null,
        createElement(PaginatedTable<{ id: number; name: string }>, {
          columns: [{ key: "name", header: "Name" }],
          rows: [
            { id: 1, name: "Ada" },
            { id: 2, name: "Grace" },
          ],
          pagination: { page: 2, pages: 5, total: 50, limit: 10 },
          onPageChange: () => undefined,
        }),
      ),
    );
    expect(markup).toContain("Ada");
    expect(markup).toContain("Grace");
    expect(markup).toContain("<table");
    expect(markup).toMatch(/aria-current="page"|data-active/);
    expect(
      renderToString(
        createElement(
          MantineProvider,
          null,
          createElement(PaginatedTable<{ id: number }>, {
            columns: [{ key: "id", header: "Id" }],
            rows: [],
            pagination: { page: 1, pages: 1 },
            onPageChange: () => undefined,
            emptyLabel: "No rows",
          }),
        ),
      ),
    ).toContain("No rows");
  });
});
