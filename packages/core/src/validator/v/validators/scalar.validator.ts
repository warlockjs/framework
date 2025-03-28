import {
  enumRule,
  existsExceptCurrentIdRule,
  existsExceptCurrentUserRule,
  existsRule,
  inRule,
  notInRule,
  uniqueExceptCurrentIdRule,
  uniqueExceptCurrentUserRule,
  uniqueRule,
} from "../rules";
import { BaseValidator } from "./base.validator";

export class ScalarValidator extends BaseValidator {
  /**
   * Value must be one of the given values
   */
  public enum(values: any[], errorMessage?: string) {
    const rule = this.addRule(enumRule, errorMessage);
    rule.context.options.enum = values;
    return this;
  }

  /**
   * Value must be one of the given values
   */
  public in(values: any[], errorMessage?: string) {
    return this.enum(values, errorMessage);
  }

  /**
   * Value must be unique in the database
   */
  public unique(errorMessage?: string) {
    this.addRule(uniqueRule, errorMessage);
    return this;
  }

  /**
   * Value must be unique in the database except for the current user
   */
  public uniqueExceptCurrentUser(errorMessage?: string) {
    this.addRule(uniqueExceptCurrentUserRule, errorMessage);
    return this;
  }

  /**
   * Value must be unique in the database except for the current id
   */
  public uniqueExceptCurrentId(errorMessage?: string) {
    this.addRule(uniqueExceptCurrentIdRule, errorMessage);
    return this;
  }

  /**
   * Value must exist in the database
   */
  public exists(errorMessage?: string) {
    this.addRule(existsRule, errorMessage);
    return this;
  }

  /**
   * Value must exist in the database except for the current user
   */
  public existsExceptCurrentUser(errorMessage?: string) {
    this.addRule(existsExceptCurrentUserRule, errorMessage);
    return this;
  }

  /**
   * Value must exist in the database except for the current id
   */
  public existsExceptCurrentId(errorMessage?: string) {
    this.addRule(existsExceptCurrentIdRule, errorMessage);
    return this;
  }

  /**
   * Value must be one of the given values
   */
  public allowsOnly(values: any[], errorMessage?: string) {
    const rule = this.addRule(inRule, errorMessage);
    rule.context.options.values = values;
    return this;
  }

  /**
   * Value must not be one of the given values
   */
  public forbids(values: any[], errorMessage?: string) {
    const rule = this.addRule(notInRule, errorMessage);
    rule.context.options.values = values;
    return this;
  }
}
