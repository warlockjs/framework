import {
  afterRule,
  beforeRule,
  dateRule,
  futureRule,
  pastRule,
  todayRule,
  tomorrowRule,
  yesterdayRule,
} from "../rules";
import { dateMutator } from "../mutators";
import { BaseValidator } from "./base.validator";
import type { ScalarValidator } from "./scalar.validator";

export class DateValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(dateRule, errorMessage);
    this.addMutator(dateMutator);
  }

  /**
   * Value must be in the future
   */
  public future(errorMessage?: string) {
    this.addRule(futureRule, errorMessage);
    return this;
  }

  /**
   * Value must be in the past
   */
  public past(errorMessage?: string) {
    this.addRule(pastRule, errorMessage);
    return this;
  }

  /**
   * Value must be today
   */
  public today(errorMessage?: string) {
    this.addRule(todayRule, errorMessage);
    return this;
  }

  /**
   * Value must be tomorrow
   */
  public tomorrow(errorMessage?: string) {
    this.addRule(tomorrowRule, errorMessage);
    return this;
  }

  /**
   * Value must be yesterday
   */
  public yesterday(errorMessage?: string) {
    this.addRule(yesterdayRule, errorMessage);
    return this;
  }

  /**
   * Value must be after the given date
   */
  public after(date: Date, errorMessage?: string) {
    const rule = this.addRule(afterRule, errorMessage);
    rule.context.options.date = date;
    return this;
  }

  /**
   * Value must be before the given date
   */
  public before(date: Date, errorMessage?: string) {
    const rule = this.addRule(beforeRule, errorMessage);
    rule.context.options.date = date;
    return this;
  }

  // Scalar methods
  public enum: typeof ScalarValidator.prototype.enum = ScalarValidator.prototype.enum;
  public in: typeof ScalarValidator.prototype.in = ScalarValidator.prototype.in;
  public oneOf: typeof ScalarValidator.prototype.in = ScalarValidator.prototype.in;
  public unique: typeof ScalarValidator.prototype.unique = ScalarValidator.prototype.unique;
  public uniqueExceptCurrentUser: typeof ScalarValidator.prototype.uniqueExceptCurrentUser = ScalarValidator.prototype.uniqueExceptCurrentUser;
  public uniqueExceptCurrentId: typeof ScalarValidator.prototype.uniqueExceptCurrentId = ScalarValidator.prototype.uniqueExceptCurrentId;
  public exists: typeof ScalarValidator.prototype.exists = ScalarValidator.prototype.exists;
  public existsExceptCurrentUser: typeof ScalarValidator.prototype.existsExceptCurrentUser = ScalarValidator.prototype.existsExceptCurrentUser;
  public existsExceptCurrentId: typeof ScalarValidator.prototype.existsExceptCurrentId = ScalarValidator.prototype.existsExceptCurrentId;
  public allowsOnly: typeof ScalarValidator.prototype.allowsOnly = ScalarValidator.prototype.allowsOnly;
  public forbids: typeof ScalarValidator.prototype.forbids = ScalarValidator.prototype.forbids;
  public notIn: typeof ScalarValidator.prototype.forbids = ScalarValidator.prototype.forbids;
} 