import {
  alphaNumericRule,
  alphaRule,
  colorRule,
  containsRule,
  darkColorRule,
  emailRule,
  endsWithRule,
  hexColorRule,
  hslColorRule,
  ipRule,
  ip4Rule,
  ip6Rule,
  isCreditCardRule,
  isNumericRule,
  lengthRule,
  lightColorRule,
  matchesRule,
  maxLengthRule,
  minLengthRule,
  notContainsRule,
  patternRule,
  rgbColorRule,
  rgbaColorRule,
  startsWithRule,
  stringRule,
  uploadableRule,
  urlRule,
  withoutWhitespaceRule,
  wordsRule,
} from "../rules";
import {
  capitalizeMutator,
  lowercaseMutator,
  stringMutator,
  uppercaseMutator,
} from "../mutators";
import { BaseValidator } from "./base.validator";
import type { ScalarValidator } from "./scalar.validator";

export class StringValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(stringRule, errorMessage);
    this.addMutator(stringMutator);
  }

  /**
   * Convert string to lowercase
   */
  public lowercase() {
    this.addMutator(lowercaseMutator);
    return this;
  }

  /**
   * Convert string to uppercase
   */
  public uppercase() {
    this.addMutator(uppercaseMutator);
    return this;
  }

  /**
   * Capitalize the first letter of the string
   */
  public capitalize() {
    this.addMutator(capitalizeMutator);
    return this;
  }

  /**
   * Value must be a valid email
   */
  public email(errorMessage?: string) {
    this.addRule(emailRule, errorMessage);
    return this;
  }

  /**
   * Value must be a valid URL
   */
  public url(errorMessage?: string) {
    this.addRule(urlRule, errorMessage);
    return this;
  }

  /**
   * Value must match the value of the given field
   */
  public matches(field: string, errorMessage?: string) {
    const rule = this.addRule(matchesRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /**
   * Value can not have whitespace
   */
  public withoutWhitespace(errorMessage?: string) {
    this.addRule(withoutWhitespaceRule, errorMessage);
    return this;
  }

  /**
   * Value must match the given pattern
   */
  public pattern(pattern: RegExp, errorMessage?: string) {
    const rule = this.addRule(patternRule, errorMessage);
    rule.context.options.pattern = pattern;
    return this;
  }

  /**
   * Validate the current string as an uploadable hash id
   */
  public uploadable(errorMessage?: string) {
    this.addRule(uploadableRule, errorMessage);
    return this;
  }

  /**
   * Value must be exactly the given number of words
   */
  public words(words: number, errorMessage?: string) {
    const rule = this.addRule(wordsRule, errorMessage);
    rule.context.options.words = words;
    return this;
  }

  /**
   * Value length must be greater than the given length
   */
  public minLength(length: number, errorMessage?: string) {
    const rule = this.addRule(minLengthRule, errorMessage);
    rule.context.options.minLength = length;
    return this;
  }

  /**
   * Value length must be less than the given length
   */
  public maxLength(length: number, errorMessage?: string) {
    const rule = this.addRule(maxLengthRule, errorMessage);
    rule.context.options.maxLength = length;
    return this;
  }

  /**
   * Value must be of the given length
   */
  public length(length: number, errorMessage?: string) {
    const rule = this.addRule(lengthRule, errorMessage);
    rule.context.options.length = length;
    return this;
  }

  /**
   * Allow only alphabetic characters
   */
  public alpha(errorMessage?: string) {
    this.addRule(alphaRule, errorMessage);
    return this;
  }

  /**
   * Allow only alphanumeric characters
   */
  public alphanumeric(errorMessage?: string) {
    this.addRule(alphaNumericRule, errorMessage);
    return this;
  }

  /**
   * Allow only numeric characters
   */
  public numeric(errorMessage?: string) {
    this.addRule(isNumericRule, errorMessage);
    return this;
  }

  /**
   * Value must starts with the given string
   */
  public startsWith(value: string, errorMessage?: string) {
    const rule = this.addRule(startsWithRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must ends with the given string
   */
  public endsWith(value: string, errorMessage?: string) {
    const rule = this.addRule(endsWithRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must contain the given string
   */
  public contains(value: string, errorMessage?: string) {
    const rule = this.addRule(containsRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must not contain the given string
   */
  public notContains(value: string, errorMessage?: string) {
    const rule = this.addRule(notContainsRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must be a valid IP address
   */
  public ip(errorMessage?: string) {
    this.addRule(ipRule, errorMessage);
    return this;
  }

  /**
   * Value must be a valid IPv4 address
   */
  public ip4(errorMessage?: string) {
    this.addRule(ip4Rule, errorMessage);
    return this;
  }

  /**
   * Value must be a valid IPv6 address
   */
  public ip6(errorMessage?: string) {
    this.addRule(ip6Rule, errorMessage);
    return this;
  }

  /**
   * Check if the string matches a credit card number
   */
  public creditCard(errorMessage?: string) {
    this.addRule(isCreditCardRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid color
   */
  public color(errorMessage?: string) {
    this.addRule(colorRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid hex color
   */
  public hexColor(errorMessage?: string) {
    this.addRule(hexColorRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid HSL color
   */
  public hslColor(errorMessage?: string) {
    this.addRule(hslColorRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid RGB color
   */
  public rgbColor(errorMessage?: string) {
    this.addRule(rgbColorRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid RGBA color
   */
  public rgbaColor(errorMessage?: string) {
    this.addRule(rgbaColorRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid light color
   */
  public lightColor(errorMessage?: string) {
    this.addRule(lightColorRule, errorMessage);
    return this;
  }

  /**
   * Determine if the value is a valid dark color
   */
  public darkColor(errorMessage?: string) {
    this.addRule(darkColorRule, errorMessage);
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