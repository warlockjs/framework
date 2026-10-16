import { describe, expect, it } from "vitest";
import { getFeatureOptions } from "../src/features/features-map";
import { fitOptionsToWidth, multiselectMaxItems } from "../src/prompts/fit-to-terminal";

/**
 * The feature multiselect drew a fresh copy of itself on every keypress when it
 * did not fit the terminal: 22 options, and a focused row whose hint was up to
 * 215 characters long. These pin the sizing that keeps the prompt within the
 * terminal (5.30.0).
 */

/** The width of a focused multiselect row as clack draws it: `│  ◻ label (hint)`. */
function rowWidth(option: { label: string; hint?: string }): number {
  return 5 + option.label.length + (option.hint ? option.hint.length + 3 : 0);
}

describe("multiselectMaxItems", () => {
  it("shows every option when the terminal is tall enough", () => {
    expect(multiselectMaxItems(22, 60)).toBe(22);
  });

  it("pages a long list to the terminal's height, leaving room for the prompt's own lines", () => {
    expect(multiselectMaxItems(22, 24)).toBe(18);
    expect(multiselectMaxItems(22, 15)).toBe(9);
  });

  it("never goes below clack's own minimum of five rows", () => {
    expect(multiselectMaxItems(22, 8)).toBe(5);
    expect(multiselectMaxItems(3, 8)).toBe(3);
  });

  it("assumes a 24-row terminal when the output reports no size (pipe, CI)", () => {
    expect(multiselectMaxItems(22, undefined)).toBe(18);
    expect(multiselectMaxItems(22, 0)).toBe(18);
  });
});

describe("fitOptionsToWidth", () => {
  it("keeps every feature row on one line of an 80-column terminal", () => {
    const fitted = fitOptionsToWidth(getFeatureOptions(), 80);

    for (const option of fitted) {
      expect(rowWidth(option), option.label).toBeLessThan(80);
    }
  });

  it("keeps rows on one line of a narrow 40-column terminal, dropping hints with no room", () => {
    const fitted = fitOptionsToWidth(getFeatureOptions(), 40);

    for (const option of fitted) {
      expect(rowWidth(option), option.label).toBeLessThan(40);
    }
  });

  it("leaves a hint that already fits untouched and shortens a long one with an ellipsis", () => {
    const [short, long] = fitOptionsToWidth(
      [
        { value: "a", label: "Alpha", hint: "fits" },
        { value: "b", label: "Beta", hint: "x".repeat(200) },
      ],
      60,
    );

    expect(short).toEqual({ value: "a", label: "Alpha", hint: "fits" });
    expect(long.hint?.endsWith("…")).toBe(true);
    expect(rowWidth(long)).toBeLessThan(60);
  });

  it("keeps value and label exactly, so selections and assertions on them are unaffected", () => {
    const original = getFeatureOptions();
    const fitted = fitOptionsToWidth(original, 40);

    expect(fitted.map(({ value, label }) => ({ value, label }))).toEqual(
      original.map(({ value, label }) => ({ value, label })),
    );
  });

  it("assumes 80 columns when the output reports no width", () => {
    expect(fitOptionsToWidth(getFeatureOptions(), undefined)).toEqual(
      fitOptionsToWidth(getFeatureOptions(), 80),
    );
  });
});
