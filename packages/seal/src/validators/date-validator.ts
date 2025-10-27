import dayjs from "dayjs";
import {
  addDaysMutator,
  addHoursMutator,
  addMonthsMutator,
  addYearsMutator,
  dateMutator,
  toEndOfDayMutator,
  toEndOfMonthMutator,
  toEndOfYearMutator,
  toStartOfDayMutator,
  toStartOfMonthMutator,
  toStartOfYearMutator,
  toUTCMutator,
} from "../mutators";
import {
  afterFieldRule,
  afterTodayRule,
  ageRule,
  beforeFieldRule,
  beforeHourRule,
  beforeMinuteRule,
  beforeTodayRule,
  betweenAgeRule,
  betweenDatesRule,
  betweenDaysRule,
  betweenHoursRule,
  betweenMinutesRule,
  betweenMonthsRule,
  betweenTimesRule,
  betweenYearsRule,
  birthdayRule,
  businessDayRule,
  dateRule,
  fromHourRule,
  fromMinuteRule,
  fromTodayRule,
  futureRule,
  leapYearRule,
  maxAgeRule,
  maxDateRule,
  maxDayRule,
  maxMonthRule,
  maxYearRule,
  minAgeRule,
  minDateRule,
  minDayRule,
  minMonthRule,
  minYearRule,
  monthRule,
  pastRule,
  quarterRule,
  sameAsFieldDateRule,
  todayRule,
  weekDayRule,
  weekdaysRule,
  weekendRule,
  withinDaysRule,
  withinFutureDaysRule,
  withinPastDaysRule,
  yearRule,
} from "../rules";
import type { WeekDay } from "../types/date-types";
import { BaseValidator } from "./base-validator";

/**
 * Date validator class
 */
export class DateValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addMutator(dateMutator); // Normalize to Date object first
    this.addRule(dateRule, errorMessage);
  }

  // ==================== Output Transformers ====================
  // These transform the Date after validation into different formats

  /**
   * Convert date to ISO string format
   * @category transformer
   */
  public toISOString() {
    this.addTransformer(data =>
      data instanceof Date ? data.toISOString() : data,
    );
    return this;
  }

  /** Convert date to Unix timestamp (milliseconds) */
  public toTimestamp() {
    this.addTransformer(data => (data instanceof Date ? data.getTime() : data));
    return this;
  }

  // ==================== String Format Transformers ====================
  // These convert Date to formatted strings after validation

  /** Convert date to specific format using dayjs */
  public toFormat(format: string) {
    this.addTransformer(
      (data, { options }) =>
        data instanceof Date ? dayjs(data).format(options.format) : data,
      { format },
    );
    return this;
  }

  /** Convert to date only (remove time, returns YYYY-MM-DD) */
  public toDateOnly() {
    this.addTransformer(data =>
      data instanceof Date ? dayjs(data).format("YYYY-MM-DD") : data,
    );
    return this;
  }

  /** Convert to time only (returns HH:MM:SS) */
  public toTimeOnly() {
    this.addTransformer(data =>
      data instanceof Date ? dayjs(data).format("HH:mm:ss") : data,
    );
    return this;
  }

  // ==================== Date Mutators ====================
  // These modify the Date object before validation

  /**
   * Convert date to start of day (00:00:00)
   * @category mutator
   */
  public toStartOfDay() {
    this.addMutator(toStartOfDayMutator);
    return this;
  }

  /** Convert date to end of day (23:59:59.999) */
  public toEndOfDay() {
    this.addMutator(toEndOfDayMutator);
    return this;
  }

  /** Add or subtract days from date */
  public addDays(days: number) {
    this.addMutator(addDaysMutator, { days });
    return this;
  }

  /** Add or subtract months from date */
  public addMonths(months: number) {
    this.addMutator(addMonthsMutator, { months });
    return this;
  }

  /** Add or subtract years from date */
  public addYears(years: number) {
    this.addMutator(addYearsMutator, { years });
    return this;
  }

  /** Add or subtract hours from date */
  public addHours(hours: number) {
    this.addMutator(addHoursMutator, { hours });
    return this;
  }

  /** Convert date to UTC */
  public toUTC() {
    this.addMutator(toUTCMutator);
    return this;
  }

  // ==================== Date Range Mutators ====================

  /** Set to start of month */
  public toStartOfMonth() {
    this.addMutator(toStartOfMonthMutator);
    return this;
  }

  /** Set to end of month */
  public toEndOfMonth() {
    this.addMutator(toEndOfMonthMutator);
    return this;
  }

  /** Set to start of year */
  public toStartOfYear() {
    this.addMutator(toStartOfYearMutator);
    return this;
  }

  /** Set to end of year */
  public toEndOfYear() {
    this.addMutator(toEndOfYearMutator);
    return this;
  }

  // ==================== Date Comparison ====================

  /**
   * Date must be greater than or equal to the given date or field (inclusive)
   *
   * Smart detection:
   * - Date instance, timestamp, or date string (with - or /) → value comparison
   * - Plain string → field comparison
   *
   * @param dateOrField - Date, timestamp, date string, or field name
   *
   * @example
   * ```ts
   * // Value comparison
   * v.date().min('2024-01-01')
   * v.date().min(new Date())
   * v.date().min(1698278400000)
   *
   * // Field comparison
   * v.date().min('startsAt')
   * ```
   *
   * @category Validation Rule
   */
  public min(dateOrField: Date | string | number, errorMessage?: string): this {
    const rule = this.addRule(minDateRule, errorMessage);
    rule.context.options.dateOrField = dateOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Date must be less than or equal to the given date or field (inclusive)
   *
   * Smart detection:
   * - Date instance, timestamp, or date string (with - or /) → value comparison
   * - Plain string → field comparison
   *
   * @category Validation Rule
   */
  public max(dateOrField: Date | string | number, errorMessage?: string): this {
    const rule = this.addRule(maxDateRule, errorMessage);
    rule.context.options.dateOrField = dateOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Date must be strictly less than the given date or field (exclusive)
   *
   * Smart detection:
   * - Date instance, timestamp, or date string (with - or /) → value comparison
   * - Plain string → field comparison
   *
   * @category Validation Rule
   */
  public before(
    dateOrField: Date | string | number,
    errorMessage?: string,
  ): this {
    const rule = this.addRule(beforeFieldRule, errorMessage);
    rule.context.options.dateOrField = dateOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Date must be strictly greater than the given date or field (exclusive)
   *
   * Smart detection:
   * - Date instance, timestamp, or date string (with - or /) → value comparison
   * - Plain string → field comparison
   *
   * @category Validation Rule
   */
  public after(
    dateOrField: Date | string | number,
    errorMessage?: string,
  ): this {
    const rule = this.addRule(afterFieldRule, errorMessage);
    rule.context.options.dateOrField = dateOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /** Date must be between start and end dates */
  public between(startDate: Date, endDate: Date, errorMessage?: string) {
    const rule = this.addRule(betweenDatesRule, errorMessage);
    rule.context.options.startDate = startDate;
    rule.context.options.endDate = endDate;
    return this;
  }

  /** Date must be exactly today */
  public today(errorMessage?: string) {
    this.addRule(todayRule, errorMessage);
    return this;
  }

  /** Date must be today or in the future */
  public fromToday(errorMessage?: string) {
    this.addRule(fromTodayRule, errorMessage);
    return this;
  }

  /** Date must be before today */
  public beforeToday(errorMessage?: string) {
    this.addRule(beforeTodayRule, errorMessage);
    return this;
  }

  /** Date must be after today (not including today) */
  public afterToday(errorMessage?: string) {
    this.addRule(afterTodayRule, errorMessage);
    return this;
  }

  /** Date must be in the past */
  public past(errorMessage?: string) {
    this.addRule(pastRule, errorMessage);
    return this;
  }

  /** Date must be in the future */
  public future(errorMessage?: string) {
    this.addRule(futureRule, errorMessage);
    return this;
  }

  // ==================== Sibling Field Comparison ====================
  // Explicit sibling scope methods

  /**
   * Date must be >= sibling field value (inclusive)
   * @category Validation Rule
   */
  public minSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(minDateRule, errorMessage);
    rule.context.options.dateOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Date must be <= sibling field value (inclusive)
   * @category Validation Rule
   */
  public maxSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(maxDateRule, errorMessage);
    rule.context.options.dateOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Date must be < sibling field value (exclusive)
   * @category Validation Rule
   */
  public beforeSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(beforeFieldRule, errorMessage);
    rule.context.options.dateOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Date must be > sibling field value (exclusive)
   * @category Validation Rule
   */
  public afterSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(afterFieldRule, errorMessage);
    rule.context.options.dateOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /** Date must be the same as another field's date */
  public sameAsField(field: string, errorMessage?: string) {
    const rule = this.addRule(sameAsFieldDateRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /** Date must be the same as another sibling field's date */
  public sameAsFieldSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(sameAsFieldDateRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== Time Validation ====================

  /** Time must be from specific hour onwards (0-23) */
  public fromHour(hour: number, errorMessage?: string) {
    const rule = this.addRule(fromHourRule, errorMessage);
    rule.context.options.hour = hour;
    return this;
  }

  /** Time must be before specific hour (0-23) */
  public beforeHour(hour: number, errorMessage?: string) {
    const rule = this.addRule(beforeHourRule, errorMessage);
    rule.context.options.hour = hour;
    return this;
  }

  /** Time must be between start and end hours (0-23) */
  public betweenHours(
    startHour: number,
    endHour: number,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenHoursRule, errorMessage);
    rule.context.options.startHour = startHour;
    rule.context.options.endHour = endHour;
    return this;
  }

  /** Time must be from specific minute onwards (0-59) */
  public fromMinute(minute: number, errorMessage?: string) {
    const rule = this.addRule(fromMinuteRule, errorMessage);
    rule.context.options.minute = minute;
    return this;
  }

  /** Time must be before specific minute (0-59) */
  public beforeMinute(minute: number, errorMessage?: string) {
    const rule = this.addRule(beforeMinuteRule, errorMessage);
    rule.context.options.minute = minute;
    return this;
  }

  /** Time must be between start and end minutes (0-59) */
  public betweenMinutes(
    startMinute: number,
    endMinute: number,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenMinutesRule, errorMessage);
    rule.context.options.startMinute = startMinute;
    rule.context.options.endMinute = endMinute;
    return this;
  }

  /** Time must be between start and end times (HH:MM format) */
  public betweenTimes(
    startTime: string,
    endTime: string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenTimesRule, errorMessage);
    rule.context.options.startTime = startTime;
    rule.context.options.endTime = endTime;
    return this;
  }

  // ==================== Age Validation ====================

  /** Age must be exactly the given years */
  public age(years: number, errorMessage?: string) {
    const rule = this.addRule(ageRule, errorMessage);
    rule.context.options.years = years;
    return this;
  }

  /** Minimum age requirement */
  public minAge(years: number, errorMessage?: string) {
    const rule = this.addRule(minAgeRule, errorMessage);
    rule.context.options.years = years;
    return this;
  }

  /** Maximum age requirement */
  public maxAge(years: number, errorMessage?: string) {
    const rule = this.addRule(maxAgeRule, errorMessage);
    rule.context.options.years = years;
    return this;
  }

  /** Age must be between min and max years */
  public betweenAge(minAge: number, maxAge: number, errorMessage?: string) {
    const rule = this.addRule(betweenAgeRule, errorMessage);
    rule.context.options.minAge = minAge;
    rule.context.options.maxAge = maxAge;
    return this;
  }

  // ==================== Day Validation ====================

  /** Date must be specific weekday */
  public weekDay(day: WeekDay, errorMessage?: string) {
    const rule = this.addRule(weekDayRule, errorMessage);
    rule.context.options.day = day;
    return this;
  }

  /** Date must be one of specified weekdays */
  public weekdays(days: WeekDay[], errorMessage?: string) {
    const rule = this.addRule(weekdaysRule, errorMessage);
    rule.context.options.days = days;
    return this;
  }

  /** Date must be a weekend (Saturday or Sunday) */
  public weekend(errorMessage?: string) {
    this.addRule(weekendRule, errorMessage);
    return this;
  }

  /** Date must be a business day (Monday-Friday) */
  public businessDay(errorMessage?: string) {
    this.addRule(businessDayRule, errorMessage);
    return this;
  }

  /** Date must match specific format */
  public format(format: string, errorMessage?: string) {
    const rule = this.addRule(dateRule, errorMessage);
    rule.context.options.format = format;
    return this;
  }

  // ==================== Relative Date Validation ====================

  /** Date must be within X days from now (past or future) */
  public withinDays(days: number, errorMessage?: string) {
    const rule = this.addRule(withinDaysRule, errorMessage);
    rule.context.options.days = days;
    return this;
  }

  /** Date must be within X days in the past */
  public withinPastDays(days: number, errorMessage?: string) {
    const rule = this.addRule(withinPastDaysRule, errorMessage);
    rule.context.options.days = days;
    return this;
  }

  /** Date must be within X days in the future */
  public withinFutureDays(days: number, errorMessage?: string) {
    const rule = this.addRule(withinFutureDaysRule, errorMessage);
    rule.context.options.days = days;
    return this;
  }

  // ==================== Period Validation ====================

  /** Date must be in specific month (1-12) */
  public month(month: number, errorMessage?: string) {
    const rule = this.addRule(monthRule, errorMessage);
    rule.context.options.month = month;
    return this;
  }

  /** Date must be in specific year */
  public year(year: number, errorMessage?: string) {
    const rule = this.addRule(yearRule, errorMessage);
    rule.context.options.year = year;
    return this;
  }

  /**
   * Date must be between start and end years
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public betweenYears(
    startYear: number | string,
    endYear: number | string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenYearsRule, errorMessage);
    rule.context.options.startYear = startYear;
    rule.context.options.endYear = endYear;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Date must be between start and end months (1-12)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public betweenMonths(
    startMonth: number | string,
    endMonth: number | string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenMonthsRule, errorMessage);
    rule.context.options.startMonth = startMonth;
    rule.context.options.endMonth = endMonth;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Date must be between start and end days (1-31)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public betweenDays(
    startDay: number | string,
    endDay: number | string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenDaysRule, errorMessage);
    rule.context.options.startDay = startDay;
    rule.context.options.endDay = endDay;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Date must be between sibling field years
   * @category Validation Rule
   */
  public betweenYearsSibling(
    startYearField: string,
    endYearField: string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenYearsRule, errorMessage);
    rule.context.options.startYear = startYearField;
    rule.context.options.endYear = endYearField;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Date must be between sibling field months
   * @category Validation Rule
   */
  public betweenMonthsSibling(
    startMonthField: string,
    endMonthField: string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenMonthsRule, errorMessage);
    rule.context.options.startMonth = startMonthField;
    rule.context.options.endMonth = endMonthField;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Date must be between sibling field days
   * @category Validation Rule
   */
  public betweenDaysSibling(
    startDayField: string,
    endDayField: string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenDaysRule, errorMessage);
    rule.context.options.startDay = startDayField;
    rule.context.options.endDay = endDayField;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Year must be >= given year or field
   * Smart detection: number or field name
   *
   * @example
   * ```ts
   * // Value comparison
   * v.date().minYear(2024)
   *
   * // Field comparison
   * v.date().minYear('startYear')
   * ```
   *
   * @category Validation Rule
   */
  public minYear(yearOrField: number | string, errorMessage?: string): this {
    const rule = this.addRule(minYearRule, errorMessage);
    rule.context.options.yearOrField = yearOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Year must be <= given year or field
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public maxYear(yearOrField: number | string, errorMessage?: string): this {
    const rule = this.addRule(maxYearRule, errorMessage);
    rule.context.options.yearOrField = yearOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Month must be >= given month or field (1-12)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public minMonth(monthOrField: number | string, errorMessage?: string): this {
    const rule = this.addRule(minMonthRule, errorMessage);
    rule.context.options.monthOrField = monthOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Month must be <= given month or field (1-12)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public maxMonth(monthOrField: number | string, errorMessage?: string): this {
    const rule = this.addRule(maxMonthRule, errorMessage);
    rule.context.options.monthOrField = monthOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Day must be >= given day or field (1-31)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public minDay(dayOrField: number | string, errorMessage?: string): this {
    const rule = this.addRule(minDayRule, errorMessage);
    rule.context.options.dayOrField = dayOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Day must be <= given day or field (1-31)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public maxDay(dayOrField: number | string, errorMessage?: string): this {
    const rule = this.addRule(maxDayRule, errorMessage);
    rule.context.options.dayOrField = dayOrField;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Year must be >= sibling field year
   * @category Validation Rule
   */
  public minYearSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(minYearRule, errorMessage);
    rule.context.options.yearOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Year must be <= sibling field year
   * @category Validation Rule
   */
  public maxYearSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(maxYearRule, errorMessage);
    rule.context.options.yearOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Month must be >= sibling field month
   * @category Validation Rule
   */
  public minMonthSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(minMonthRule, errorMessage);
    rule.context.options.monthOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Month must be <= sibling field month
   * @category Validation Rule
   */
  public maxMonthSibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(maxMonthRule, errorMessage);
    rule.context.options.monthOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Day must be >= sibling field day
   * @category Validation Rule
   */
  public minDaySibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(minDayRule, errorMessage);
    rule.context.options.dayOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Day must be <= sibling field day
   * @category Validation Rule
   */
  public maxDaySibling(field: string, errorMessage?: string): this {
    const rule = this.addRule(maxDayRule, errorMessage);
    rule.context.options.dayOrField = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /** Date must be in specific quarter (1-4) */
  public quarter(quarter: 1 | 2 | 3 | 4, errorMessage?: string) {
    const rule = this.addRule(quarterRule, errorMessage);
    rule.context.options.quarter = quarter;
    return this;
  }

  // ==================== Special Validation ====================

  /** Valid birthday (not in future, reasonable age) */
  public birthday(minAge?: number, maxAge?: number, errorMessage?: string) {
    const rule = this.addRule(birthdayRule, errorMessage);
    if (minAge !== undefined) {
      rule.context.options.minAge = minAge;
    }
    if (maxAge !== undefined) {
      rule.context.options.maxAge = maxAge;
    }
    return this;
  }

  /** Date must be in a leap year */
  public leapYear(errorMessage?: string) {
    this.addRule(leapYearRule, errorMessage);
    return this;
  }
}
