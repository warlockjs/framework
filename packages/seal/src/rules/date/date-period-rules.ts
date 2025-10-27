import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Month rule - date must be in specific month (1-12)
 */
export const monthRule: SchemaRule<{ month: number }> = {
  name: "month",
  defaultErrorMessage: "The :input must be in month :month",
  async validate(value: Date, context) {
    const inputDate = new Date(value);
    const month = inputDate.getMonth() + 1; // getMonth() returns 0-11

    if (month === this.context.options.month) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Year rule - date must be in specific year
 */
export const yearRule: SchemaRule<{ year: number }> = {
  name: "year",
  defaultErrorMessage: "The :input must be in year :year",
  async validate(value: Date, context) {
    const inputDate = new Date(value);
    const year = inputDate.getFullYear();

    if (year === this.context.options.year) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Between years rule - date must be between start and end years
 */
export const betweenYearsRule: SchemaRule<{
  startYear: number;
  endYear: number;
}> = {
  name: "betweenYears",
  defaultErrorMessage: "The :input must be between :startYear and :endYear",
  async validate(value: Date, context) {
    const inputDate = new Date(value);
    const year = inputDate.getFullYear();
    const { startYear, endYear } = this.context.options;

    if (year >= startYear && year <= endYear) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Quarter rule - date must be in specific quarter (1-4)
 */
export const quarterRule: SchemaRule<{ quarter: 1 | 2 | 3 | 4 }> = {
  name: "quarter",
  defaultErrorMessage: "The :input must be in quarter :quarter",
  async validate(value: Date, context) {
    const inputDate = new Date(value);
    const month = inputDate.getMonth() + 1;
    const quarter = Math.ceil(month / 3);

    if (quarter === this.context.options.quarter) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Between times rule - time must be between start and end times (HH:MM format)
 */
export const betweenTimesRule: SchemaRule<{
  startTime: string;
  endTime: string;
}> = {
  name: "betweenTimes",
  defaultErrorMessage: "The :input must be between :startTime and :endTime",
  async validate(value: Date, context) {
    const inputDate = new Date(value);
    const inputHour = inputDate.getHours();
    const inputMinute = inputDate.getMinutes();
    const inputTimeInMinutes = inputHour * 60 + inputMinute;

    const { startTime, endTime } = this.context.options;

    // Parse start time
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const startTimeInMinutes = startHour * 60 + startMinute;

    // Parse end time
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const endTimeInMinutes = endHour * 60 + endMinute;

    if (
      inputTimeInMinutes >= startTimeInMinutes &&
      inputTimeInMinutes <= endTimeInMinutes
    ) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};
