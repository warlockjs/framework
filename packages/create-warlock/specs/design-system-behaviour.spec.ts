import { describe, expect, it } from "vitest";
import {
  calendarDate,
  parseCalendarDate,
} from "../templates/design-system/src/web/design-system/hooks/use-date-control";
import {
  selectedValues,
  toggleSelection,
} from "../templates/design-system/src/web/design-system/hooks/use-select-control";

describe("design system form values", () => {
  it("round trips calendar dates without interpreting them as UTC instants", () => {
    const date = parseCalendarDate("2028-02-29");
    expect(date).toBeInstanceOf(Date);
    if (date) expect(calendarDate(date)).toBe("2028-02-29");
    expect(parseCalendarDate("2027-02-29")).toBeUndefined();
    expect(parseCalendarDate("2028-13-01")).toBeUndefined();
    expect(parseCalendarDate("2028-02-29T00:00:00Z")).toBeUndefined();
    expect(parseCalendarDate("")).toBeUndefined();
  });

  it("keeps empty selection, a single value and multiple values distinct", () => {
    expect(selectedValues("")).toEqual([]);
    expect(selectedValues(undefined)).toEqual([]);
    expect(selectedValues("blue")).toEqual(["blue"]);
    expect(selectedValues(["blue", 4, "green"])).toEqual(["blue", "green"]);
  });

  it("toggles selections without mutating the form's existing array", () => {
    const initial = ["blue"];
    expect(toggleSelection(initial, "green")).toEqual(["blue", "green"]);
    expect(toggleSelection(initial, "blue")).toEqual([]);
    expect(initial).toEqual(["blue"]);
  });
});
